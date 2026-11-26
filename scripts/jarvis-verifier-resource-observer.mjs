#!/usr/bin/env node
/** Unsigned, provisional diagnostics only. Import/default execution is inert. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, fork as nodeFork } from "node:child_process";
import { request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE = fileURLToPath(import.meta.url);
const ID = /^[a-f0-9]{64}$/;
const NAME = /^\/goriq-verifier-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CAPS = { cycles: 210, samples: 210, containers: 8, intervalMs: 10000, wallMs: 2100000, artifactBytes: 2097152 };
const FAILURE = new Set(["OK", "DISAPPEARED", "HTTP_STATUS", "INVALID_JSON", "RESPONSE_LIMIT", "TRANSPORT_ERROR", "REQUEST_TIMEOUT", "STOPPED"]);
const safe = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const failState = () => { throw Error("OBSERVER_STATE_UNSAFE"); };

export function assertObserverCI({ env = process.env, platform = process.platform, argv = process.argv.slice(2) } = {}) {
  if (argv.length !== 1 || !["--observe", "--stop"].includes(argv[0])) throw Error("OBSERVER_EXPLICIT_REQUIRED");
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || !isAbsolute(env.RUNNER_TEMP ?? "") || env.DOCKER_HOST || env.DOCKER_CONTEXT || env.DOCKER_TLS_VERIFY || env.DOCKER_CERT_PATH)
    throw Error("OBSERVER_HOSTED_REQUIRED");
}

export function selectContainers(value, { startSecond, nowSecond, maximum = 8, seen = new Set() }) {
  const out = [];
  if (!Array.isArray(value)) return out;
  const ids = new Set(seen);
  for (const row of value) {
    if (ids.size >= Math.min(8, maximum)) break;
    if (!row || typeof row.Id !== "string" || !ID.test(row.Id) || !Array.isArray(row.Names) || row.Names.length !== 1
      || typeof row.Names[0] !== "string" || !NAME.test(row.Names[0])
      || safe(row.Created) === null || row.Created < startSecond || row.Created > nowSecond || ids.has(row.Id)) continue;
    ids.add(row.Id);
    out.push({ id: row.Id, name: row.Names[0].slice(1), createdSecond: row.Created,
      imageId: typeof row.ImageID === "string" && /^sha256:[a-f0-9]{64}$/.test(row.ImageID) ? row.ImageID : null, association: "PROVISIONAL" });
  }
  return out;
}

export function projectStats(value) {
  const cpu = value?.cpu_stats, memory = value?.memory_stats, pids = value?.pids_stats;
  return { cpuUsageNs: safe(cpu?.cpu_usage?.total_usage), systemCpuNs: safe(cpu?.system_cpu_usage), onlineCpus: safe(cpu?.online_cpus),
    cpuPeriods: safe(cpu?.throttling_data?.periods), cpuThrottledPeriods: safe(cpu?.throttling_data?.throttled_periods), cpuThrottledNs: safe(cpu?.throttling_data?.throttled_time),
    memoryUsageBytes: safe(memory?.usage), memoryLimitBytes: safe(memory?.limit), memoryCacheBytes: safe(memory?.stats?.cache),
    memoryPeakBytes: null, memoryEvents: null, pidsCurrent: safe(pids?.current), pidsLimit: safe(pids?.limit) };
}

// Injection exists only for public tests. CLI exposes no endpoint, method or executable controls.
export function createDockerTransport({ request = httpRequest, timeoutMs = 2000 } = {}) {
  return async (route, { signal } = {}) => {
    const keys = Object.keys(route).sort().join(",");
    const path = route.kind === "list" && keys === "kind" ? "/v1.41/containers/json?all=0"
      : route.kind === "stats" && keys === "id,kind" && typeof route.id === "string" && ID.test(route.id) ? `/v1.41/containers/${route.id}/stats?stream=false` : null;
    if (!path) throw Error("OBSERVER_ROUTE_INVALID");
    return new Promise(resolve => {
      let req, res, done = false, bytes = 0;
      const chunks = [];
      const finish = (code, value = null) => {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        res?.destroy(); req?.destroy(); resolve({ code, value });
      };
      const abort = () => finish("STOPPED");
      const timer = setTimeout(() => finish("REQUEST_TIMEOUT"), Math.max(1, Math.min(2000, timeoutMs)));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { finish("STOPPED"); return; }
      try {
        req = request({ socketPath: "/var/run/docker.sock", path, method: "GET", agent: false, headers: { Accept: "application/json" } }, incoming => {
          res = incoming;
          res.on("error", () => finish("TRANSPORT_ERROR"));
          res.on("aborted", () => finish("TRANSPORT_ERROR"));
          res.on("close", () => { if (!res.complete && !res.readableEnded) finish("TRANSPORT_ERROR"); });
          if (res.statusCode !== 200) { finish(res.statusCode === 404 ? "DISAPPEARED" : "HTTP_STATUS"); return; }
          res.on("data", chunk => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 524288) { finish("RESPONSE_LIMIT"); return; }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (done) return;
            try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); finish("OK", value); }
            catch { finish("INVALID_JSON"); }
          });
        });
        req.on("error", () => finish("TRANSPORT_ERROR"));
        req.on("upgrade", (_res, socket) => { socket.destroy(); finish("HTTP_STATUS"); });
        req.end();
      } catch { finish("TRANSPORT_ERROR"); }
    });
  };
}

function cleanMetadata(metadata) {
  if (["sourceRevision", "helperSha256", "runId", "runAttempt"].some(field => typeof metadata?.[field] !== "string")
    || !/^[a-f0-9]{40}$/.test(metadata?.sourceRevision) || !/^[a-f0-9]{64}$/.test(metadata?.helperSha256)
    || !/^[1-9][0-9]{0,19}$/.test(metadata?.runId) || !/^[1-9][0-9]{0,5}$/.test(metadata?.runAttempt)) throw Error("OBSERVER_METADATA_INVALID");
  return { sourceRevision: metadata.sourceRevision, runId: metadata.runId, runAttempt: metadata.runAttempt, helperSha256: metadata.helperSha256 };
}

export async function runObserver({ metadata, startSecond = Math.ceil(Date.now() / 1000), nowSecond = () => Math.floor(Date.now() / 1000),
  now = () => performance.now(), wait = sleep, get = createDockerTransport(), stopRequested = () => false, persist = () => {}, onReady = () => {}, limits = {} }) {
  const caps = Object.fromEntries(Object.entries(CAPS).map(([key, value]) => [key, Math.max(1, Math.min(value, safe(limits[key]) ?? value))]));
  const started = now(), cpuStart = process.cpuUsage();
  const artifact = { schema: "goriq-resource-observer-v1", evidenceClass: "UNSIGNED_SUPPLEMENTAL", acceptance: false, metadata: cleanMetadata(metadata),
    startedSecond: startSecond, status: "UNAVAILABLE", stopReason: null, containers: [], samples: [], cycles: 0, requestCount: 0, requestWallMs: 0,
    discoveryFailures: 0, lastDiscoveryCode: null, terminalOom: "UNKNOWN", truePeaks: "UNKNOWN", processExitObserved: false,
    overhead: { cpuUserUs: 0, cpuSystemUs: 0, wallMs: 0 } };
  let partial = false, pendingUnconfirmed = false, wallExpired = false;
  const checkpoint = () => {
    const cpu = process.cpuUsage(cpuStart);
    artifact.overhead = { cpuUserUs: cpu.user, cpuSystemUs: cpu.system, wallMs: Math.max(0, now() - started) };
    persist(artifact);
  };
  const reason = () => stopRequested() ? "STOP_REQUESTED" : wallExpired || now() - started >= caps.wallMs ? "WALL_LIMIT" : null;
  const call = async route => {
    const controller = new globalThis.AbortController(), at = now();
    artifact.requestCount++;
    let timer, poll;
    const boundary = new Promise(resolve => {
      const stop = () => { controller.abort(); pendingUnconfirmed = true; resolve({ code: reason() === "STOP_REQUESTED" ? "STOPPED" : "REQUEST_TIMEOUT", value: null }); };
      const remaining = caps.wallMs - (now() - started);
      timer = setTimeout(() => { if (remaining <= 2000) wallExpired = true; stop(); }, Math.max(1, Math.min(2000, remaining)));
      poll = setInterval(() => { if (reason()) stop(); }, 10);
    });
    let value;
    try { value = await Promise.race([Promise.resolve().then(() => get(route, { signal: controller.signal })), boundary]); }
    catch { value = { code: "TRANSPORT_ERROR", value: null }; }
    finally { clearTimeout(timer); clearInterval(poll); artifact.requestWallMs += Math.max(0, now() - at); }
    return value && FAILURE.has(value.code) ? value : { code: "TRANSPORT_ERROR", value: null };
  };
  checkpoint(); onReady();
  while (!reason() && artifact.cycles < caps.cycles && artifact.samples.length < caps.samples) {
    artifact.cycles++;
    const list = await call({ kind: "list" });
    artifact.lastDiscoveryCode = list.code;
    if (list.code === "OK" && Array.isArray(list.value)) {
      artifact.containers.push(...selectContainers(list.value, { startSecond, nowSecond: nowSecond(), maximum: caps.containers, seen: new Set(artifact.containers.map(c => c.id)) }));
    } else { artifact.discoveryFailures++; partial = true; }
    if (reason() || pendingUnconfirmed) break;
    for (const container of artifact.containers) {
      if (reason() || artifact.samples.length >= caps.samples) break;
      const result = await call({ kind: "stats", id: container.id });
      const sample = { containerId: container.id, elapsedMs: Math.max(0, now() - started), code: result.code, metrics: projectStats(result.code === "OK" ? result.value : null) };
      if (result.code !== "OK") partial = true;
      artifact.samples.push(sample);
      // Reserve room for final counters/status; do not silently truncate records.
      if (Buffer.byteLength(JSON.stringify(artifact)) + 512 > caps.artifactBytes) {
        artifact.samples.pop(); artifact.stopReason = "ARTIFACT_LIMIT"; partial = true; break;
      }
      checkpoint();
      if (pendingUnconfirmed) break;
    }
    checkpoint();
    if (artifact.stopReason || pendingUnconfirmed || reason()) break;
    const until = now() + Math.min(caps.intervalMs, Math.max(0, caps.wallMs - (now() - started)));
    while (now() < until && !reason()) await wait(Math.max(1, Math.min(50, until - now())));
  }
  artifact.stopReason ??= reason() ?? (pendingUnconfirmed ? "REQUEST_UNCONFIRMED" : artifact.samples.length >= caps.samples ? "SAMPLE_LIMIT" : "CYCLE_LIMIT");
  if (artifact.stopReason !== "STOP_REQUESTED") partial = true;
  artifact.status = artifact.samples.length === 0 ? "UNAVAILABLE" : partial ? "PARTIAL" : "COMPLETE";
  checkpoint();
  return artifact;
}

function checkedDirectory(directory, own = false) {
  if (realpathSync(directory) !== resolve(directory)) failState();
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || (own && ((st.mode & 0o777) !== 0o700 || st.uid !== process.getuid()))) failState();
}
function stateDirectory(env, metadata) {
  const m = cleanMetadata(metadata), root = env.RUNNER_TEMP;
  if (!isAbsolute(root ?? "") || env.GITHUB_RUN_ID !== m.runId || env.GITHUB_RUN_ATTEMPT !== m.runAttempt) failState();
  checkedDirectory(root);
  const directory = join(root, `goriq-verifier-resource-observer-${m.runId}-${m.runAttempt}`);
  if (directory === process.cwd() || directory.startsWith(process.cwd() + sep)) failState();
  return directory;
}
function safeRead(file, maximum = 4096) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const st = fstatSync(fd); if (!st.isFile() || st.uid !== process.getuid() || st.nlink !== 1 || st.size > maximum || (st.mode & 0o077)) failState(); return readFileSync(fd, "utf8"); }
  finally { closeSync(fd); }
}
function safeWrite(file, value, exclusive = false) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | (exclusive ? constants.O_EXCL : 0), 0o600);
  try { const st = fstatSync(fd); if (!st.isFile() || st.uid !== process.getuid() || st.nlink !== 1 || (st.mode & 0o077)) failState(); writeFileSync(fd, value, { encoding: "utf8" }); }
  finally { closeSync(fd); }
}
export function createObserverState({ env = process.env, metadata }) {
  try {
    const directory = stateDirectory(env, metadata); mkdirSync(directory, { mode: 0o700 }); checkedDirectory(directory, true);
    mkdirSync(join(directory, "artifact"), { mode: 0o700 });
    const nonce = randomUUID(); safeWrite(join(directory, "owner.json"), JSON.stringify({ ...cleanMetadata(metadata), nonce }), true);
    return { directory, nonce };
  } catch { failState(); }
}
export function openObserverState({ env = process.env, metadata }) {
  try {
    const directory = stateDirectory(env, metadata); checkedDirectory(directory, true); checkedDirectory(join(directory, "artifact"), true);
    const owner = JSON.parse(safeRead(join(directory, "owner.json")));
    if (JSON.stringify(cleanMetadata(owner)) !== JSON.stringify(cleanMetadata(metadata)) || !/^[a-f0-9-]{36}$/.test(owner.nonce)) failState();
    return { directory, nonce: owner.nonce };
  } catch { failState(); }
}
function stopExists(state) {
  checkedDirectory(state.directory, true);
  try { return safeRead(join(state.directory, "stop")) === state.nonce; }
  catch (error) { if (error.code === "ENOENT") return false; failState(); }
}
function markStop(state) {
  checkedDirectory(state.directory, true);
  try { safeWrite(join(state.directory, "stop"), state.nonce, true); }
  catch (error) {
    if (error.code !== "EEXIST") failState();
    try { if (safeRead(join(state.directory, "stop")) !== state.nonce) failState(); }
    catch { failState(); }
  }
}
export function requestObserverStop({ env = process.env, metadata, timeoutMs = 5000 }) {
  const state = openObserverState({ env, metadata }); markStop(state);
  return (async () => {
    const started = performance.now();
    do {
      try {
        if (safeRead(join(state.directory, "ack")) === state.nonce) return { code: "STOP_CONFIRMED", samplingStopped: true, processExitObserved: false };
      } catch (error) { if (error.code !== "ENOENT") failState(); }
      await sleep(10);
    } while (performance.now() - started < Math.min(5000, timeoutMs));
    return { code: "STOP_UNCONFIRMED", samplingStopped: false, processExitObserved: false };
  })();
}
export async function runObserverWorker({ state, metadata, onReady = () => {}, get = createDockerTransport() }) {
  const persist = value => {
    checkedDirectory(state.directory, true); checkedDirectory(join(state.directory, "artifact"), true);
    const bytes = JSON.stringify(value) + "\n"; if (Buffer.byteLength(bytes) > CAPS.artifactBytes) throw Error("OBSERVER_ARTIFACT_LIMIT");
    const destination = join(state.directory, "artifact", "resource-observer.json");
    try {
      const st = lstatSync(destination);
      if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || (st.mode & 0o077)) failState();
    } catch (error) { if (error.code !== "ENOENT") failState(); }
    const temporary = join(state.directory, "artifact", "resource-observer.pending");
    safeWrite(temporary, bytes, true); renameSync(temporary, destination);
  };
  const result = await runObserver({ metadata, get, stopRequested: () => stopExists(state), persist, onReady });
  // Acknowledges sampler finalization, never claims separate-step OS exit observation.
  safeWrite(join(state.directory, "ack"), state.nonce, true);
  return result;
}
export async function startObserver({ env = process.env, metadata, fork = nodeFork, readyTimeoutMs = 3000 }) {
  const state = createObserverState({ env, metadata });
  return new Promise(resolve => {
    let child, finished = false;
    const finish = code => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (code !== "READY") { try { markStop(state); } catch {} }
      try { child?.disconnect(); } catch {}
      child?.unref(); resolve({ code });
    };
    const timer = setTimeout(() => finish("START_UNCONFIRMED"), Math.max(1, Math.min(3000, readyTimeoutMs)));
    try {
      child = fork(FILE, ["--observe"], { env, stdio: ["ignore", "ignore", "ignore", "ipc"], detached: true });
      child.on("error", () => finish("START_UNCONFIRMED"));
      child.on("exit", () => finish("START_UNCONFIRMED"));
      child.on("message", msg => { if (msg?.code === "READY" && msg.nonce === state.nonce) finish("READY"); });
      child.send({ nonce: state.nonce });
    } catch { finish("START_UNCONFIRMED"); }
  });
}

function actualMetadata() {
  const sourceRevision = execFileSync("/usr/bin/git", ["rev-parse", "--verify", "HEAD"], { cwd: dirname(dirname(FILE)), encoding: "utf8", timeout: 2000, maxBuffer: 128, stdio: ["ignore", "pipe", "ignore"] }).trim();
  return cleanMetadata({ sourceRevision, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    helperSha256: createHash("sha256").update(readFileSync(FILE)).digest("hex") });
}
async function main() {
  if (process.argv.length === 2) return;
  assertObserverCI(); const metadata = actualMetadata();
  if (process.argv[2] === "--stop") {
    const result = await requestObserverStop({ metadata }); process.stdout.write(JSON.stringify(result) + "\n");
    if (result.code !== "STOP_CONFIRMED") process.exitCode = 1;
  } else if (process.send) {
    const nonce = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("OBSERVER_START_UNCONFIRMED")), 3000);
      process.once("message", value => { clearTimeout(timer); resolve(value?.nonce); });
    });
    const state = openObserverState({ metadata }); if (state.nonce !== nonce) failState();
    await runObserverWorker({ state, metadata, onReady: () => process.send?.({ code: "READY", nonce }) });
  } else {
    const result = await startObserver({ metadata }); process.stdout.write(JSON.stringify(result) + "\n");
    if (result.code !== "READY") process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write("OBSERVER_UNAVAILABLE\n"); process.exitCode = 1; });
}
