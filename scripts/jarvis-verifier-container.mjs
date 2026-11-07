/** Bounded Docker CLI lifecycle. The owner-provisioned Docker daemon, runtime
 * and image remain trusted dependencies; tests of this module are not physical
 * container-isolation or process-cleanup acceptance evidence.
 */
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";

const failure = code => Object.assign(new Error(code), { code });
const bounded = (value, maximum) => Number.isInteger(value) && value > 0 && value <= maximum;

function dockerExecutable(untrustedRoots, env) {
  // Candidate, staged checkout and exported source must never supply host tools.
  const filename = process.platform === "win32" ? "docker.exe" : "docker";
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, filename);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const file = realpathSync(candidate);
    for (const root of untrustedRoots) {
      const inside = relative(root, file);
      if (!inside || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep))) {
        throw failure("VERIFIER_CONTAINER_EXECUTABLE_IN_WORKSPACE");
      }
    }
    return file;
  }
  throw failure("VERIFIER_CONTAINER_RUNTIME_UNAVAILABLE");
}

function runProcess(executable, args, options) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString(), started = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - started) / 1_000_000;
    let firstOutputElapsedMs = null, lastOutputElapsedMs = null;
    const output = { status: null, signal: null, stdout: "", stderr: "", closeObserved: false };
    const chunks = { stdout: [], stderr: [] };
    let child, deadline, grace, total = 0, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(grace);
      output.stdout = Buffer.concat(chunks.stdout).toString("utf8");
      output.stderr = Buffer.concat(chunks.stderr).toString("utf8");
      // CLI lifetime/output arrival, not test-file start/completion times.
      output.cliTiming = { startedAt, elapsedMs: elapsed(), firstOutputElapsedMs, lastOutputElapsedMs };
      if (!output.closeObserved && child) {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      }
      resolve(output);
    };
    const terminate = code => {
      if (settled || output.error) return;
      output.error = failure(code);
      // A CLI which ignores/does not deliver close cannot strand cleanup.
      grace = setTimeout(finish, options.killGraceMs);
      try { child.kill("SIGKILL"); } catch { /* Absence of close remains explicit. */ }
    };
    try {
      child = spawn(executable, args, { cwd: options.cwd, env: options.env,
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", chunk => {
          if (settled || output.error) return;
          lastOutputElapsedMs = elapsed();
          firstOutputElapsedMs ??= lastOutputElapsedMs;
          const bytes = Buffer.from(chunk), available = Math.max(0, options.maxBuffer - total);
          // Own only retained bytes: an empty/subarray view would otherwise
          // retain arbitrarily large original chunks after output overflow.
          if (available) chunks[stream].push(Buffer.from(bytes.subarray(0, available)));
          total += bytes.length;
          if (total > options.maxBuffer) terminate("ENOBUFS");
        });
        child[stream].on("error", () => terminate("VERIFIER_CONTAINER_OUTPUT_ERROR"));
      }
      child.once("error", error => { output.error ??= failure(error.code ?? "VERIFIER_CONTAINER_SPAWN_FAILED"); finish(); });
      child.once("close", (status, signal) => {
        output.status = status; output.signal = signal; output.closeObserved = true; finish();
      });
      deadline = setTimeout(() => terminate("ETIMEDOUT"), options.timeoutMs);
    } catch (error) {
      output.error = failure(error.code ?? "VERIFIER_CONTAINER_SPAWN_FAILED"); finish();
    }
  });
}

const record = result => ({ status: result.status, signal: result.signal,
  stdout: result.stdout, stderr: result.stderr, errorCode: result.error?.code ?? null,
  closeObserved: result.closeObserved, cliTiming: result.cliTiming });

export async function runVerifierContainer(args, {
  cwd, env, timeoutMs = 180_000, maxBuffer = 2 * 1024 * 1024,
  cleanupTimeoutMs = 8_000, killGraceMs = 1_000,
  untrustedExecutableRoots = [],
} = {}) {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !env || typeof env !== "object" ||
      !Array.isArray(args) || args.length < 2 || args.length > 128 || args[0] !== "run" ||
      args.some(arg => typeof arg !== "string" || arg.includes("\0") || arg.length > 16_384 ||
        /^--(?:name|cidfile)(?:=|$)/.test(arg)) ||
      !Array.isArray(untrustedExecutableRoots) || untrustedExecutableRoots.length > 8 ||
      untrustedExecutableRoots.some(root => typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) ||
      !bounded(timeoutMs, 300_000) || !bounded(maxBuffer, 2 * 1024 * 1024) ||
      !bounded(cleanupTimeoutMs, 30_000) || !bounded(killGraceMs, 1_000)) {
    throw failure("VERIFIER_CONTAINER_REQUEST_INVALID");
  }
  let executable;
  try { executable = dockerExecutable([cwd, ...untrustedExecutableRoots].map(root => realpathSync(root)), env); }
  catch (error) {
    return { status: null, signal: null, stdout: "", stderr: "", error,
      closeObserved: false, cleanup: { attempted: false, confirmed: false } };
  }
  const containerName = `goriq-verifier-${randomUUID()}`;
  const options = { cwd, env, timeoutMs, maxBuffer, killGraceMs };
  const cleanupOptions = { ...options, timeoutMs: cleanupTimeoutMs, maxBuffer: 4096 };
  let result, cleanup;
  try {
    result = await runProcess(executable, ["run", "--name", containerName, ...args.slice(1)], options);
  } finally {
    const removal = await runProcess(executable, ["rm", "--force", "--volumes", containerName], cleanupOptions);
    // A successful empty daemon listing proves absence; an inspect failure alone
    // cannot distinguish an absent container from an unreachable daemon. This
    // also accepts automatic --rm cleanup without treating rm's exit 1 as PASS.
    const inspection = await runProcess(executable, ["container", "ls", "--all",
      "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"], cleanupOptions);
    cleanup = { attempted: true, containerName,
      confirmed: result?.closeObserved === true && removal.closeObserved && !removal.error && inspection.closeObserved &&
        !inspection.error && inspection.status === 0 && inspection.stdout.trim() === "",
      removal: record(removal), inspection: record(inspection) };
  }
  if (!cleanup.confirmed) {
    return { ...result, runErrorCode: result.error?.code ?? null, cleanup,
      error: failure("VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED") };
  }
  return { ...result, cleanup };
}

// Hosted entry lifetime. Imports only capture inert identity and original real
// clock references; no network/filesystem/runtime operation happens on import.
const hostedMonoNow = process.hrtime.bigint.bind(process.hrtime);
const hostedUtcNow = Date.now.bind(Date);
const hostedOriginMono = hostedMonoNow(); // MUST precede the UTC observation.
const hostedOriginUtc = hostedUtcNow();
const HOSTED_NS = 1_000_000n;
const HOSTED_ACCEPTANCE_MS = 1_800_000;
const HOSTED_OUTER_MS = 2_100_000;
const HOSTED_RESERVE_MS = 600_000;
const HOSTED_CHILD_TAIL_MS = 19_000;
const HOSTED_CHECKS = Object.freeze(["lint", "typecheck", "unit", "integration", "security", "build"]);
const HOSTED_ENV_KEYS = Object.freeze(["GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_OWNER",
  "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_WORKFLOW", "GITHUB_REF", "GITHUB_EVENT_NAME",
  "GITHUB_WORKSPACE", "RUNNER_ENVIRONMENT", "RUNNER_OS", "RUNNER_TEMP", "DOCKER_HOST", "DOCKER_CONTEXT"]);
const hostedOriginalVerifierEnv = Object.freeze(Object.fromEntries(["GORIQ_VERIFIER_OPERATOR_ISOLATED", "GORIQ_VERIFIER_CONTAINER_IMAGE", "GORIQ_CI_PRIVATE_CANARY"].map(key => [key, process.env[key] ?? null])));
const hostedEntryPath = fileURLToPath(new URL("./jarvis-verifier-live-ci.mjs", import.meta.url));
const hostedCapture = Object.freeze({ platform: process.platform, argv: JSON.stringify(process.argv),
  cwd: process.cwd(), env: Object.freeze(Object.fromEntries(HOSTED_ENV_KEYS.map(key => [key, process.env[key] ?? null]))) });
const hostedEligible = hostedCapture.platform === "linux" && process.argv.length === 3
  && resolve(process.argv[1] ?? "") === hostedEntryPath && process.argv[2] === "--execute-hosted-ci"
  && hostedCapture.env.GITHUB_ACTIONS === "true" && hostedCapture.env.GITHUB_REPOSITORY === "haji84/AI-"
  && hostedCapture.env.GITHUB_REPOSITORY_OWNER === "haji84" && hostedCapture.env.GITHUB_RUN_ATTEMPT === "1"
  && /^[1-9][0-9]{0,19}$/.test(hostedCapture.env.GITHUB_RUN_ID ?? "")
  && hostedCapture.env.GITHUB_JOB === "independent-verifier-container" && hostedCapture.env.GITHUB_WORKFLOW === "CI"
  && ["pull_request", "pull_request_review", "push", "workflow_dispatch"].includes(hostedCapture.env.GITHUB_EVENT_NAME)
  && typeof hostedCapture.env.GITHUB_REF === "string" && /^refs\/(?:heads|pull)\//.test(hostedCapture.env.GITHUB_REF)
  && hostedCapture.env.RUNNER_OS === "Linux" && hostedCapture.env.RUNNER_ENVIRONMENT === "github-hosted"
  && isAbsolute(hostedCapture.env.RUNNER_TEMP ?? "") && !hostedCapture.env.DOCKER_HOST && !hostedCapture.env.DOCKER_CONTEXT;
const hostedLifetimes = new WeakMap();
let hostedEntryConsumed = false;
const hostedHash = bytes => createHash("sha256").update(bytes).digest("hex");
const hostedMinimum = (...values) => values.reduce((a, b) => a < b ? a : b);
const hostedStages = new Set(["SETUP", "SETUP_RETURN", "SAFE_GIT_BEFORE", "SAFE_GIT_AFTER", "ATTEST_BEFORE", "ATTEST_AFTER",
  "CHECK_BEFORE", "CHECK_RETURN", "SIGN_BEFORE", "SIGN_AFTER", "RECEIPT_BEFORE", "RECEIPT_AFTER", "AUDIT_BEFORE", "AUDIT_AFTER",
  "EVIDENCE_BEFORE", "EVIDENCE_AFTER", "GLOBAL_CLEANUP_CONFIRMED", "CLEANUP", "FINAL_ACCEPT", "FINAL_CHECK", "FINAL_AFTER", "REFUSED"]);
function hostedReject(state, code) {
  if (state) { state.terminal = true; state.failureCode ??= code; }
  throw failure(code);
}
function hostedState(token) {
  const state = token && typeof token === "object" ? hostedLifetimes.get(token) : null;
  if (!state) hostedReject(null, "HOSTED_CI_TOKEN_INVALID");
  return state;
}
function hostedClock(state, cleanupOnly = false) {
  const pre = hostedMonoNow();
  if (typeof pre !== "bigint" || pre < state.lastMono) { state.cleanupTerminal = true; hostedReject(state, "HOSTED_CI_MONOTONIC_INVALID"); }
  if (cleanupOnly) { state.lastMono = pre; return { pre, post: pre }; }
  const utc = hostedUtcNow(), post = hostedMonoNow();
  if (typeof post !== "bigint" || post < pre) { state.cleanupTerminal = true; hostedReject(state, "HOSTED_CI_MONOTONIC_INVALID"); }
  if (!Number.isSafeInteger(utc) || utc < state.lastUtc) hostedReject(state, "HOSTED_CI_CLOCK_INVALID");
  state.lastUtc = utc; state.lastMono = post;
  // Use pre-UTC stamp. Post-UTC scheduling delays cannot renew this mapping.
  state.acceptanceMono = hostedMinimum(state.acceptanceMono, pre + BigInt(state.utcCut - utc) * HOSTED_NS);
  if (post >= state.acceptanceMono || utc >= state.utcCut) hostedReject(state, "HOSTED_CI_ACCEPTANCE_EXPIRED");
  return { pre, post, utc };
}
function hostedSourcePins() {
  return Object.freeze(Object.fromEntries(["jarvis-verifier-container.mjs", "jarvis-independent-check-runner.mjs", "jarvis-verifier-live-ci.mjs", "jarvis-independent-artifact-attestation.mjs", "jarvis-verifier-safe-git.mjs", "../.github/workflows/ci.yml"]
    .map(name => { const file = join(dirname(hostedEntryPath), name), info = statSync(file);
      if (!info.isFile() || info.size < 1 || info.size > 262144) throw failure("HOSTED_CI_SOURCE_INVALID");
      return [file, hostedHash(readFileSync(file))]; })));
}
function hostedRequestSnapshot(req) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw failure("HOSTED_CI_REQUEST_INVALID");
  const forbidden = ["hostedCiLifetime", "hostedCiProfile", "hostedBudget", "timeoutMs", "checkTimeoutMs", "timeoutProfile",
    "executor", "clock", "acceptanceMs", "budget"];
  if (forbidden.some(key => Object.hasOwn(req, key))) throw failure("HOSTED_CI_REQUEST_HOST_FIELD");
  const keys = ["goalId", "jobId", "changeSetId", "builderId", "verifierId", "baseRevision", "sourceRevision", "artifactDigest",
    "targetPath", "allowedUntracked", "trackedEdits", "requiredChecks", "candidateWorkspace", "verifierWorkspace", "privateKeyFile", "receiptFile", "expiresAt"];
  const snapshot = JSON.stringify(Object.fromEntries(keys.filter(key => Object.hasOwn(req, key)).map(key => [key, req[key]])));
  if (Buffer.byteLength(snapshot) > 24576) throw failure("HOSTED_CI_REQUEST_INVALID");
  return snapshot;
}
function hostedIdentity(state) {
  try {
    if (process.platform !== hostedCapture.platform || process.cwd() !== hostedCapture.cwd || JSON.stringify(process.argv) !== hostedCapture.argv
      || HOSTED_ENV_KEYS.some(key => (process.env[key] ?? null) !== hostedCapture.env[key])) hostedReject(state, "HOSTED_CI_CONTEXT_DRIFT");
    if (state.request) {
      if (state.requestSnapshot !== hostedRequestSnapshot(state.request)) hostedReject(state, "HOSTED_CI_REQUEST_DRIFT");
      if (state.cleanupDone) {
        if (Object.entries(hostedOriginalVerifierEnv).some(([key,value]) => (process.env[key] ?? null) !== value)) hostedReject(state, "HOSTED_CI_ENV_CLEANUP_DRIFT");
      } else if (process.env.GORIQ_VERIFIER_CONTAINER_IMAGE !== state.image || process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED !== "1")
        hostedReject(state, "HOSTED_CI_REQUEST_DRIFT");
    }
    if (state.sourcePins && Object.entries(state.sourcePins).some(([file,digest]) => hostedHash(readFileSync(file)) !== digest))
      hostedReject(state, "HOSTED_CI_SOURCE_DRIFT");
  } catch(error) { hostedReject(state,error.code?.startsWith("HOSTED_CI_") ? error.code : "HOSTED_CI_IDENTITY_INVALID"); }
}
function hostedRemaining(cut, mono) {
  const delta = cut - mono;
  return delta > 0n ? Number(delta / HOSTED_NS) : 0;
}
function hostedData(state, point, cleanup = false) {
  return Object.freeze({ remainingMs: hostedRemaining(cleanup ? state.outerMono : state.acceptanceMono, point.post),
    originalAcceptanceMono: (state.originalAcceptanceMono ?? state.acceptanceMono).toString(), retainedAcceptanceMono: state.acceptanceMono.toString(),
    observedMono: point.post.toString(), observedUtc: point.utc ?? null, originalOfficialOuterMono: state.outerMono?.toString() ?? null,
    expiresAt: state.context?.expiresAt ?? null, acceptanceEligible: !state.terminal && !state.finalized,
    failureCode: state.failureCode ?? null, reserveMs: HOSTED_RESERVE_MS, childTailMs: HOSTED_CHILD_TAIL_MS });
}
function canonicalHostedHttpDate(raw) {
  if (typeof raw !== "string") throw failure("HOSTED_CI_HTTP_DATE_INVALID");
  const ms = Date.parse(raw);
  if (!Number.isSafeInteger(ms) || new Date(ms).toUTCString() !== raw) throw failure("HOSTED_CI_HTTP_DATE_INVALID");
  return ms;
}
async function hostedOfficialGet(state, path) {
  hostedClock(state);
  const preMono = hostedMonoNow();
  if (typeof preMono !== "bigint" || preMono < state.lastMono) hostedReject(state,"HOSTED_CI_MONOTONIC_INVALID");
  return await new Promise((resolveResponse, reject) => {
    let request, timer, settled = false, total = 0;
    const chunks = [];
    const stop = error => { if (settled) return; settled = true; clearTimeout(timer); request?.destroy(); reject(error); };
    timer = setTimeout(() => stop(failure("HOSTED_CI_METADATA_TIMEOUT")), 10000);
    try {
      request = httpsRequest({ hostname: "api.github.com", port: 443, path, method: "GET", headers: {
        "User-Agent": "GORIQ-hosted-verifier", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "Cache-Control": "no-cache", Pragma: "no-cache" } }, response => {
        if (response.statusCode !== 200) { response.resume(); stop(failure("HOSTED_CI_METADATA_STATUS")); return; }
        response.on("error", () => stop(failure("HOSTED_CI_METADATA_ERROR")));
        response.on("aborted", () => stop(failure("HOSTED_CI_METADATA_ERROR")));
        response.on("data", chunk => { total += chunk.length; if (total > 262144) stop(failure("HOSTED_CI_METADATA_SIZE"));
          else if (!settled) chunks.push(Buffer.from(chunk)); });
        response.on("end", () => {
          if (settled) return;
          try {
            const dates = []; const ages = [];
            for (let i = 0; i < response.rawHeaders.length; i += 2) {
              if (response.rawHeaders[i].toLowerCase() === "date") dates.push(response.rawHeaders[i + 1]);
              if (response.rawHeaders[i].toLowerCase() === "age") ages.push(response.rawHeaders[i + 1]);
            }
            if (dates.length !== 1 || ages.length > 1 || (ages.length && ages[0] !== "0")
              || response.headers.warning || /(?:HIT|stale)/i.test(String(response.headers["x-cache"] ?? "") + String(response.headers["cache-status"] ?? ""))
              || response.headers.link) throw failure("HOSTED_CI_METADATA_FRESHNESS");
            const dateMs = canonicalHostedHttpDate(dates[0]);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            // Complete response AND Date/JSON parsing precedes this projection.
            const postMono = hostedMonoNow(), hostUtc = hostedUtcNow(), completeMono = hostedMonoNow();
            if (typeof postMono !== "bigint" || postMono < preMono || typeof completeMono !== "bigint" || completeMono < postMono)
              throw failure("HOSTED_CI_MONOTONIC_INVALID");
            if (completeMono - preMono > 10000n * HOSTED_NS) throw failure("HOSTED_CI_METADATA_TIMEOUT");
            const rttCeilMs = Number((postMono - preMono + HOSTED_NS - 1n) / HOSTED_NS);
            if (rttCeilMs > 10000 || !Number.isSafeInteger(hostUtc) || hostUtc < state.lastUtc || Math.abs(hostUtc - dateMs) > 10000)
              throw failure("HOSTED_CI_METADATA_CLOCK");
            // Retain this UTC sample using its pre-UTC stamp. A later stalled
            // wall clock or delayed UTC return cannot recover the tightening.
            state.acceptanceMono = hostedMinimum(state.acceptanceMono, postMono + BigInt(state.utcCut - hostUtc) * HOSTED_NS);
            if (completeMono >= state.acceptanceMono || hostUtc >= state.utcCut) throw failure("HOSTED_CI_ACCEPTANCE_EXPIRED");
            state.lastUtc = hostUtc; state.lastMono = completeMono;
            settled = true; clearTimeout(timer); resolveResponse({ body, dateMs, postMono, hostUtc, rttCeilMs });
          } catch (error) { stop(failure(error.code?.startsWith("HOSTED_CI_") ? error.code : "HOSTED_CI_METADATA_INVALID")); }
        });
      });
      request.once("error", () => stop(failure("HOSTED_CI_METADATA_ERROR"))); request.end();
    } catch { stop(failure("HOSTED_CI_METADATA_ERROR")); }
  });
}
function hostedOfficialIdentity(runObservation, jobsObservation, baseRevision) {
  const run = runObservation.body, jobs = jobsObservation.body, id = Number(hostedCapture.env.GITHUB_RUN_ID);
  if (!Number.isSafeInteger(id) || run?.id !== id || run.run_attempt !== 1 || run.status !== "in_progress"
    || run.head_sha !== baseRevision || run.name !== "CI" || run.path !== ".github/workflows/ci.yml"
    || run.event !== hostedCapture.env.GITHUB_EVENT_NAME || run.repository?.full_name !== "haji84/AI-" || run.repository.private !== false
    || run.head_repository?.full_name !== "haji84/AI-" || !Number.isSafeInteger(run.workflow_id) || run.workflow_id < 1)
    throw failure("HOSTED_CI_OFFICIAL_RUN_MISMATCH");
  if (!Number.isInteger(jobs?.total_count) || jobs.total_count < 1 || jobs.total_count > 100
    || !Array.isArray(jobs.jobs) || jobs.jobs.length !== jobs.total_count
    || jobs.jobs.some(job => !Number.isSafeInteger(job.id) || job.id < 1 || job.run_id !== id || job.run_attempt !== 1)
    || new Set(jobs.jobs.map(job => job.id)).size !== jobs.jobs.length) throw failure("HOSTED_CI_OFFICIAL_JOBS_INVALID");
  const matches = jobs.jobs.filter(job => job.name === "independent-verifier-container");
  if (matches.length !== 1) throw failure("HOSTED_CI_OFFICIAL_JOB_AMBIGUOUS");
  const job = matches[0], started = Date.parse(job.started_at);
  if (job.status !== "in_progress" || job.head_sha !== baseRevision || JSON.stringify(job.labels) !== '["ubuntu-latest"]'
    || !Number.isSafeInteger(started) || new Date(started).toISOString().replace(".000Z", "Z") !== job.started_at
    || started > Math.min(runObservation.dateMs + 1000 + runObservation.rttCeilMs, jobsObservation.dateMs + 1000 + jobsObservation.rttCeilMs)
    || jobsObservation.dateMs < runObservation.dateMs) throw failure("HOSTED_CI_OFFICIAL_JOB_INVALID");
  const officialUtc = started + HOSTED_OUTER_MS;
  const outerMono = hostedMinimum(...[runObservation, jobsObservation].map(o =>
    o.postMono + BigInt(officialUtc - (o.dateMs + 1000 + o.rttCeilMs)) * HOSTED_NS));
  return { outerMono, officialUtcCap: officialUtc - 21000, jobId: String(job.id), startedAt: job.started_at };
}
function hostedReadBase(state) {
  const env = { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" };
  const executable = (() => {
    for (const entry of (env.PATH ?? "").split(delimiter)) {
      if (!isAbsolute(entry)) continue;
      const file=join(entry,"git");if(!existsSync(file)||!statSync(file).isFile())continue;
      const absolute=realpathSync(file),inside=relative(realpathSync(hostedCapture.cwd),absolute);
      if(!inside||(!isAbsolute(inside)&&inside!==".."&&!inside.startsWith(".."+sep)))hostedReject(state,"HOSTED_CI_GIT_EXECUTABLE_UNSAFE");
      return absolute;
    }
    hostedReject(state,"HOSTED_CI_GIT_UNAVAILABLE");
  })();
  const query = args => {
    const point = hostedClock(state), timeout = Math.min(8000, hostedRemaining(state.acceptanceMono, point.post));
    if (timeout <= 0) hostedReject(state, "HOSTED_CI_ACCEPTANCE_EXPIRED");
    const value = execFileSync(executable, ["--no-pager", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      { cwd: hostedCapture.cwd, env, timeout, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] }).trim();
    hostedClock(state); return value;
  };
  if (realpathSync(query(["rev-parse", "--show-toplevel"])) !== realpathSync(hostedCapture.cwd)) hostedReject(state, "HOSTED_CI_BASE_INVALID");
  const base = query(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(base)) hostedReject(state, "HOSTED_CI_BASE_INVALID");
  state.gitExecutable=executable;
  return base;
}
export async function beginHostedCiEntry() {
  if (arguments.length || !hostedEligible || hostedEntryConsumed) hostedReject(null, "HOSTED_CI_ENTRY_REFUSED");
  hostedEntryConsumed = true;
  const state = { lastMono: hostedOriginMono, lastUtc: hostedOriginUtc,
    acceptanceMono: hostedOriginMono + BigInt(HOSTED_ACCEPTANCE_MS) * HOSTED_NS, utcCut: hostedOriginUtc + HOSTED_ACCEPTANCE_MS,
    originalAcceptanceMono: hostedOriginMono + BigInt(HOSTED_ACCEPTANCE_MS) * HOSTED_NS,
    phase: "ENTRY_SETUP", terminal: false, cleanupTerminal: false, nextCheck: 0, passedChecks: 0, pending: false, signStage: "NONE", receiptStage: "NONE", auditStage: "NONE", cleanupDone: false };
  try {
    hostedClock(state); hostedIdentity(state);
    const temporary = realpathSync(hostedCapture.env.RUNNER_TEMP), evidenceDirectory = join(temporary, "goriq-verifier-live-evidence");
    mkdirSync(evidenceDirectory, { mode: 0o700 });
    writeFileSync(join(evidenceDirectory, "entry.json"), JSON.stringify({ originalModuleMono: hostedOriginMono.toString(), originalModuleUtc: hostedOriginUtc,
      repository: "haji84/AI-", runId: hostedCapture.env.GITHUB_RUN_ID, attempt: 1, job: "independent-verifier-container" }) + "\n", { flag: "wx", mode: 0o600 });
    state.sourcePins = hostedSourcePins(); const baseRevision = hostedReadBase(state);
    const path = `/repos/haji84/AI-/actions/runs/${hostedCapture.env.GITHUB_RUN_ID}`;
    const run = await hostedOfficialGet(state, path);
    const jobs = await hostedOfficialGet(state, `${path}/attempts/1/jobs?per_page=100`);
    const official = hostedOfficialIdentity(run, jobs, baseRevision); state.outerMono = official.outerMono;
    state.acceptanceMono = hostedMinimum(state.acceptanceMono, state.outerMono); state.utcCut = Math.min(state.utcCut, official.officialUtcCap);
    const point = hostedClock(state), expiresAt = new Date(Math.min(state.utcCut, point.utc + hostedRemaining(state.acceptanceMono, point.post))).toISOString();
    state.utcCut = Math.min(state.utcCut, Date.parse(expiresAt));
    state.dockerExecutable=dockerExecutable([realpathSync(hostedCapture.cwd)],{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??""});
    hostedClock(state);hostedIdentity(state);
    state.context = Object.freeze({ evidenceDirectory, temporary, baseRevision, expiresAt, gitExecutable:state.gitExecutable, dockerExecutable:state.dockerExecutable, repository: "haji84/AI-",
      runId: hostedCapture.env.GITHUB_RUN_ID, attempt: 1, officialJobId: official.jobId, officialJobStartedAt: official.startedAt,
      originalModuleMono: hostedOriginMono.toString(), originalModuleUtc: hostedOriginUtc,
      originalAcceptanceMono: state.originalAcceptanceMono.toString(), officialUtcAcceptanceCap: official.officialUtcCap,
      metadataResponses: 2, originalOfficialOuterMono: state.outerMono.toString(), nativeAuthority: false });
    const token = Object.freeze(Object.create(null)); hostedLifetimes.set(token, state);
    return Object.freeze({ token, context: state.context });
  } catch (error) { state.terminal = true; throw failure(error.code?.startsWith("HOSTED_CI_") ? error.code : "HOSTED_CI_ENTRY_FAILED"); }
}
export function bindHostedCiRequest(token, req) {
  const state = hostedState(token);
  if (state.request || state.terminal || state.finalized) hostedReject(state, "HOSTED_CI_BIND_REPLAY");
  hostedClock(state); hostedIdentity(state);
  let snapshot;try{snapshot=hostedRequestSnapshot(req);}catch(error){hostedReject(state,error.code??"HOSTED_CI_REQUEST_INVALID");}
  const relativePath = value => typeof value === "string" && /^(?:src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(value) && !value.split("/").some(x=>!x||x==="."||x==="..");
  if (!["goalId","jobId","changeSetId","builderId","verifierId"].every(key=>typeof req[key]==="string"&&req[key].length>0&&req[key].length<=128)
    || req.builderId===req.verifierId || !relativePath(req.targetPath) || !Array.isArray(req.allowedUntracked) || req.allowedUntracked.length<1 || req.allowedUntracked.length>32
    || req.allowedUntracked.some(value=>!relativePath(value)) || new Set(req.allowedUntracked).size!==req.allowedUntracked.length
    || (!req.allowedUntracked.includes(req.targetPath)&&!req.trackedEdits?.files?.some(file=>file.path===req.targetPath))
    || req.baseRevision !== state.context.baseRevision || req.expiresAt !== state.context.expiresAt
    || !/^[a-f0-9]{64}$/.test(req.sourceRevision ?? "") || !/^[a-f0-9]{64}$/.test(req.artifactDigest ?? "")
    || JSON.stringify(req.requiredChecks) !== JSON.stringify(HOSTED_CHECKS)
    || ["candidateWorkspace", "verifierWorkspace", "receiptFile"].some(key => typeof req[key] !== "string" || !isAbsolute(req[key]) || resolve(req[key]) !== req[key])
    || process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED !== "1" || !/^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/.test(process.env.GORIQ_VERIFIER_CONTAINER_IMAGE ?? ""))
    hostedReject(state, "HOSTED_CI_REQUEST_BINDING_INVALID");
  state.phase = "BOUND"; state.request = req; state.requestSnapshot = snapshot; state.image = process.env.GORIQ_VERIFIER_CONTAINER_IMAGE;
  state.path = process.env.PATH ?? ""; state.systemRoot = process.env.SystemRoot ?? "";
  state.utcCut = Math.min(state.utcCut, Date.parse(req.expiresAt)); hostedClock(state);
  return Object.freeze({ expiresAt: state.context.expiresAt, sourceRevision: req.sourceRevision, nativeAuthority: false });
}
export function observeHostedCiBudget(token, stage) {
  const state = hostedState(token);
  if (!hostedStages.has(stage)) hostedReject(state, "HOSTED_CI_STAGE_INVALID");
  if (stage === "REFUSED") hostedReject(state,"HOSTED_CI_HOST_OPERATION_REFUSED");
  if (stage === "CLEANUP" || stage === "GLOBAL_CLEANUP_CONFIRMED") {
    if(state.cleanupTerminal)hostedReject(state,"HOSTED_CI_OUTER_CLOCK_INVALID");
    const point = hostedClock(state, true);
    if (!state.outerMono || point.post >= state.outerMono) hostedReject(state, "HOSTED_CI_OUTER_EXPIRED");
    if (stage === "GLOBAL_CLEANUP_CONFIRMED") state.cleanupDone = true;
    return hostedData(state, point, true);
  }
  if (state.terminal || state.finalized) hostedReject(state, "HOSTED_CI_ACCEPTANCE_TERMINAL");
  hostedClock(state); hostedIdentity(state);
  const point = hostedClock(state);
  if (hostedRemaining(state.acceptanceMono,point.post)<=0)hostedReject(state,"HOSTED_CI_ACCEPTANCE_EXPIRED");
  if(!state.request && !["SETUP","SETUP_RETURN","SAFE_GIT_BEFORE","SAFE_GIT_AFTER","ATTEST_BEFORE","ATTEST_AFTER","EVIDENCE_BEFORE","EVIDENCE_AFTER"].includes(stage))
    hostedReject(state,"HOSTED_CI_REQUEST_NOT_BOUND");
  if (state.pending && !["CHECK_BEFORE", "CHECK_RETURN"].includes(stage)) hostedReject(state, "HOSTED_CI_CONCURRENT_USE");
  if (stage.startsWith("SIGN_")) {
    if (state.pending || state.passedChecks !== 6 || (stage === "SIGN_BEFORE" ? state.signStage !== "NONE" : state.signStage !== "ENTERED"))
      hostedReject(state, "HOSTED_CI_SIGN_ORDER");
    state.signStage = stage === "SIGN_BEFORE" ? "ENTERED" : "RETURNED";
  }
  if (stage.startsWith("RECEIPT_")) {
    if (state.signStage !== "RETURNED" || (stage === "RECEIPT_BEFORE" ? state.receiptStage !== "NONE" : state.receiptStage !== "ENTERED"))
      hostedReject(state, "HOSTED_CI_RECEIPT_ORDER");
    state.receiptStage = stage === "RECEIPT_BEFORE" ? "ENTERED" : "RETURNED";
  }
  if (stage.startsWith("AUDIT_")) {
    if (state.receiptStage !== "RETURNED" || (stage === "AUDIT_BEFORE" ? state.auditStage !== "NONE" : state.auditStage !== "ENTERED"))
      hostedReject(state, "HOSTED_CI_AUDIT_ORDER");
    state.auditStage = stage === "AUDIT_BEFORE" ? "ENTERED" : "RETURNED";
  }
  if (stage === "FINAL_ACCEPT" || stage === "FINAL_CHECK" || stage === "FINAL_AFTER") {
    if (!state.cleanupDone || state.passedChecks !== 6 || state.auditStage !== "RETURNED" || state.pending)
      hostedReject(state, "HOSTED_CI_FINAL_ORDER");
    if (stage === "FINAL_AFTER") state.finalized = true;
  }
  return hostedData(state, point);
}
function hostedExpectedDocker(state, checkName) {
  const commands = { lint: "pnpm lint", typecheck: "pnpm exec tsc --noEmit", unit: "pnpm test", integration: "pnpm test",
    security: "pnpm test:p8-security", build: "pnpm build --webpack" };
  const snapshot = join(state.request.receiptFile + ".logs", "source");
  return ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=128",
    "--memory=2g", "--cpus=2", "--user=65534:65534", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,uid=65534,gid=65534,mode=0700,size=1536m",
    "--mount", `type=bind,source=${snapshot},target=/source,readonly`, "--workdir", "/", "--entrypoint", "/bin/sh", state.image, "-ec",
    "node /opt/goriq-verifier/jarvis-verifier-offline-workspace.mjs && cd /tmp/verify && exec " + commands[checkName]];
}
async function hostedCleanupProcess(token, executable, args, options) {
  try {
    const budget = observeHostedCiBudget(token, "CLEANUP"), timeoutMs = Math.min(8000, budget.remainingMs);
    if (timeoutMs <= 0) throw failure("HOSTED_CI_OUTER_EXPIRED");
    const killGraceMs = Math.min(1000, budget.remainingMs - timeoutMs);
    const result = await runProcess(executable, args, { ...options, timeoutMs, killGraceMs, maxBuffer: 4096 });
    try { observeHostedCiBudget(token, "CLEANUP"); } catch (error) { result.error = error; }
    return result;
  } catch (error) { return { status: null, signal: null, stdout: "", stderr: "", closeObserved: false, error }; }
}
export async function runHostedCiContainer(token, req, checkName, args, options) {
  const state = hostedState(token);
  if (!state.request || state.phase!=="BOUND" || state.pending || state.request !== req || state.nextCheck >= HOSTED_CHECKS.length || HOSTED_CHECKS[state.nextCheck] !== checkName)
    hostedReject(state, "HOSTED_CI_CHECK_ORDER");
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => !["cwd", "env", "untrustedExecutableRoots", "maxBuffer"].includes(key))
    || options.cwd !== req.verifierWorkspace || !bounded(options.maxBuffer ?? 2097152, 2097152)
    || JSON.stringify(options.untrustedExecutableRoots) !== JSON.stringify([req.candidateWorkspace, req.verifierWorkspace, join(req.receiptFile + ".logs", "source")])
    || !options.env || Object.keys(options.env).sort().join(",") !== "PATH,SystemRoot" || options.env.PATH !== state.path || options.env.SystemRoot !== state.systemRoot
    || JSON.stringify(args) !== JSON.stringify(hostedExpectedDocker(state, checkName))) hostedReject(state, "HOSTED_CI_OPTIONS_INVALID");
  const ownedOptions=Object.freeze({cwd:options.cwd,maxBuffer:options.maxBuffer??2097152,
    env:Object.freeze({PATH:state.path,SystemRoot:state.systemRoot}),untrustedExecutableRoots:Object.freeze([...options.untrustedExecutableRoots])});
  const ownedArgs=Object.freeze(hostedExpectedDocker(state,checkName));
  const ceiling = ["unit", "integration"].includes(checkName) ? 600000 : 180000;
  let before = observeHostedCiBudget(token, "CHECK_BEFORE");
  let timeoutMs = Math.min(ceiling, before.remainingMs - HOSTED_RESERVE_MS - HOSTED_CHILD_TAIL_MS);
  if (timeoutMs <= 0) hostedReject(state, "HOSTED_CI_CHECK_NO_BUDGET");
  state.pending = true; state.nextCheck++;
  let result, cleanup;
  try {
    const executable = dockerExecutable([ownedOptions.cwd, ...ownedOptions.untrustedExecutableRoots].map(root => realpathSync(root)), ownedOptions.env);
    if (state.dockerExecutable && state.dockerExecutable !== executable) hostedReject(state, "HOSTED_CI_EXECUTABLE_DRIFT");
    state.dockerExecutable = executable;
    const containerName = `goriq-verifier-${randomUUID()}`;
    const launchArgs=["run", "--name", containerName, ...ownedArgs.slice(1)];
    // Final real cut follows all synchronous source/executable resolution.
    before=observeHostedCiBudget(token,"CHECK_BEFORE");
    timeoutMs=Math.min(timeoutMs,ceiling,before.remainingMs-HOSTED_RESERVE_MS-HOSTED_CHILD_TAIL_MS);
    if(timeoutMs<=0)hostedReject(state,"HOSTED_CI_CHECK_NO_BUDGET");
    try { result = await runProcess(executable, launchArgs, { ...ownedOptions, timeoutMs, killGraceMs: 1000 }); }
    finally {
      const removal = await hostedCleanupProcess(token, executable, ["rm", "--force", "--volumes", containerName], ownedOptions);
      const inspection = await hostedCleanupProcess(token, executable, ["container", "ls", "--all", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"], ownedOptions);
      cleanup = { attempted: true, containerName, confirmed: result?.closeObserved === true && removal.closeObserved && !removal.error
        && inspection.closeObserved && !inspection.error && inspection.status === 0 && inspection.stdout.trim() === "",
      removal: record(removal), inspection: record(inspection) };
    }
    if (!cleanup.confirmed) result = { ...result, runErrorCode: result?.error?.code ?? null, error: failure("VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED") };
    observeHostedCiBudget(token, "CHECK_RETURN");
    if (result.error || result.status !== 0 || !cleanup.confirmed) hostedReject(state, "HOSTED_CI_CHECK_FAILED");
    state.passedChecks++;
  } catch (error) {
    state.terminal = true; state.failureCode ??= error.code ?? "HOSTED_CI_CHECK_FAILED";
    // A timely, closed nonzero exit remains an observed failed check. Hosted
    // refusal is terminal independently; preserve an underlying child error.
    const completedFailure = error.code === "HOSTED_CI_CHECK_FAILED" && cleanup?.confirmed === true
      && result?.closeObserved === true && Number.isInteger(result.status) && result.status !== 0 && !result.error;
    result = { status: null, signal: null, stdout: "", stderr: "", closeObserved: false, ...result,
      ...(completedFailure ? {} : { error: result?.error ?? error }) };
  } finally { state.pending = false; }
  return { ...result, cleanup: cleanup ?? { attempted: false, confirmed: false }, hostedBudget: { ...before, ceilingMs: ceiling, timeoutMs,
    acceptanceEligible: !state.terminal && !state.finalized, failureCode: state.failureCode ?? null } };
}
