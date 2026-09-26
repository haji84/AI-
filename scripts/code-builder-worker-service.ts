import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { basename, extname, resolve, relative, isAbsolute } from "node:path";

const host = process.env.CODE_BUILDER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.CODE_BUILDER_PORT || 8796);
const token = process.env.CODE_BUILDER_TOKEN?.trim() || "";
const workspace = resolve(process.env.CODE_BUILDER_WORKSPACE?.trim() || process.cwd());
const workerId = process.env.GAI_WORKER_ID?.trim() || hostname();
const explicitEngine = process.env.CODE_BUILDER_ENGINE?.trim() || "";
const inferenceLocality = process.env.CODE_BUILDER_INFERENCE_LOCALITY?.trim() || "unknown";
const inferenceNetworkAccess = process.env.CODE_BUILDER_INFERENCE_NETWORK_ACCESS !== "0";
const executionTimeoutMs = Number(process.env.CODE_BUILDER_EXEC_TIMEOUT_MS || 600_000);

if (!token) throw new Error("CODE_BUILDER_TOKEN is required");
if (host !== "127.0.0.1" && host !== "::1" && process.env.CODE_BUILDER_ALLOW_NON_LOOPBACK !== "1") {
  throw new Error("Refusing non-loopback bind unless CODE_BUILDER_ALLOW_NON_LOOPBACK=1");
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

function authorized(request: import("node:http").IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function resolveCommand(command: string): Promise<string | null> {
  if (existsSync(command)) return command;
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((done) => {
    const child = spawn(probe, [command], { windowsHide: true });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.once("error", () => done(null));
    child.once("exit", (code) => {
      if (code !== 0) return done(null);
      const first = stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      done(first ?? null);
    });
  });
}

function engineId(command: string): string {
  const name = basename(command).toLowerCase();
  if (name.startsWith("codex")) return "codex";
  if (name.startsWith("aider")) return "aider";
  return name.replace(extname(name), "") || "unknown";
}

async function detectEngine(): Promise<{ id: string; command: string } | null> {
  const candidates = explicitEngine ? [explicitEngine] : ["codex", "aider"];
  for (const candidate of candidates) {
    const command = await resolveCommand(candidate);
    if (command) return { id: engineId(command), command };
  }
  return null;
}

function safeWorkspacePath(path: string): boolean {
  const full = resolve(workspace, path);
  const rel = relative(workspace, full);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function run(command: string, args: string[], timeoutMs = executionTimeoutMs, stdinInput?: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((done) => {
    const extension = extname(command).toLowerCase();
    const invocation = process.platform === "win32" && extension === ".ps1"
      ? { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args] }
      : process.platform === "win32" && (extension === ".cmd" || extension === ".bat")
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
        : { command, args };
    const child = spawn(invocation.command, invocation.args, { cwd: workspace, windowsHide: true, shell: false, env: process.env, stdio: [stdinInput === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        child.kill();
      }
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk).slice(0, 100_000); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 100_000); });
    if (stdinInput !== undefined && child.stdin) {
      child.stdin.end(stdinInput);
    }
    child.once("error", (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr: String(error), timedOut }); });
    child.once("exit", (code) => { clearTimeout(timer); done({ code, stdout, stderr, timedOut }); });
  });
}

async function candidateSnapshot(baseRevision: string): Promise<{ patchDigest: string; candidateRevision: string; artifactDigest: string; artifactRef: string; changedPaths: string[] }> {
  const patch = await run("git", ["diff", "--binary", "--"]);
  const changed = await run("git", ["diff", "--name-only", "--"]);
  const untracked = await run("git", ["ls-files", "--others", "--exclude-standard"]);
  const untrackedPaths = untracked.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort();
  const changedPaths = [...new Set(`${changed.stdout}\n${untracked.stdout}`.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))].sort();
  const artifact = createHash("sha256").update("goriq-change-artifact-v1\0").update(patch.stdout, "utf8");
  for (const path of untrackedPaths) {
    if (!safeWorkspacePath(path)) throw new Error("Builder produced an unsafe untracked path");
    artifact.update(path, "utf8").update("\0").update(readFileSync(resolve(workspace, path))).update("\0");
  }
  const patchDigest = createHash("sha256").update(patch.stdout, "utf8").digest("hex");
  const artifactDigest = artifact.digest("hex");
  const candidateRevision = createHash("sha256").update(`candidate-v1\0${baseRevision}\0${artifactDigest}`).digest("hex");
  return { patchDigest, candidateRevision, artifactDigest, artifactRef: `sha256:${artifactDigest}`, changedPaths };
}

async function runVerify(body: Record<string, unknown>) {
  const contract = body.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { status: 400, body: { ok: false, summary: "verification contract required", blocker: "VERIFICATION_CONTRACT_INVALID" } };
  }
  const value = contract as { kind?: unknown; path?: unknown; expected?: unknown; profile?: unknown; requiredChecks?: unknown };
  if (value.kind === "file_exact") {
    if (typeof value.path !== "string" || typeof value.expected !== "string" || !safeWorkspacePath(value.path)) {
      return { status: 400, body: { ok: false, summary: "invalid file_exact contract", blocker: "VERIFICATION_CONTRACT_INVALID" } };
    }
    const actual = readFileSync(resolve(workspace, value.path), "utf8");
    const ok = actual === value.expected || actual === value.expected + "\n";
    return {
      status: 200,
      body: {
        ok,
        summary: ok ? "file_exact verification passed" : "file_exact verification failed",
        evidence: { kind: "file_exact", path: value.path, expected: value.expected, actual },
      },
    };
  }
  if (value.kind === "repository_checks") {
    if (value.profile !== "standard") {
      return { status: 400, body: { ok: false, summary: "invalid repository_checks profile", blocker: "VERIFICATION_CONTRACT_INVALID" } };
    }
    const binding = body.binding as { builderId?: unknown; sourceRevision?: unknown; artifactDigest?: unknown } | undefined;
    const candidate = body.candidate as { artifactRef?: unknown; changedPaths?: unknown } | undefined;
    if (!binding || typeof binding.builderId !== "string" || typeof binding.sourceRevision !== "string" || typeof binding.artifactDigest !== "string" || candidate?.artifactRef !== `sha256:${binding.artifactDigest}` || !Array.isArray(candidate.changedPaths)) {
      return { status: 400, body: { ok: false, summary: "candidate release binding required", blocker: "VERIFICATION_BINDING_INVALID" } };
    }
    const head = await run("git", ["rev-parse", "HEAD"]);
    const snapshot = await candidateSnapshot(head.stdout.trim());
    if (snapshot.candidateRevision !== binding.sourceRevision || snapshot.artifactDigest !== binding.artifactDigest || JSON.stringify(snapshot.changedPaths) !== JSON.stringify([...candidate.changedPaths].sort())) {
      return { status: 200, body: { ok: false, summary: "workspace candidate does not match release binding", blocker: "VERIFICATION_CANDIDATE_MISMATCH", evidence: { verifierId: `verifier:${workerId}`, sourceRevision: snapshot.candidateRevision, artifactDigest: snapshot.artifactDigest } } };
    }
    const required = Array.isArray(value.requiredChecks) ? value.requiredChecks.filter((item): item is string => typeof item === "string") : [];
    const unsupported = required.filter((check) => !["lint", "typecheck", "unit", "integration", "security", "build"].includes(check));
    if (!required.length || unsupported.length) return { status: 400, body: { ok: false, summary: `unsupported repository checks: ${unsupported.join(",") || "none"}`, blocker: "VERIFICATION_CHECK_UNSUPPORTED" } };
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const checks = required.map((id) => id === "lint" ? { id, args: ["lint"] }
      : id === "typecheck" ? { id, args: ["exec", "tsc", "--noEmit"] }
        : id === "security" ? { id, args: ["test:p8-security"] }
          : id === "build" ? { id, args: ["build"] }
            : { id, args: ["test"] });
    const evidence: Array<{ id: string; ok: boolean; exitCode: number | null; timedOut: boolean; failureNames: string[]; stdoutTail: string; stderrTail: string }> = [];
    for (const check of checks) {
      const result = await run(pnpm, check.args);
      const ok = result.code === 0 && !result.timedOut;
      evidence.push({
        id: check.id,
        ok,
        exitCode: result.code,
        timedOut: result.timedOut,
        failureNames: ["unit", "integration"].includes(check.id) && !ok ? [...new Set([...result.stdout.matchAll(/^\s*not ok\s+\d+\s+-\s+([^\r\n]+)/gm), ...result.stdout.matchAll(/^✖\s+([^\r\n]+)/gm)].map(match => match[1]?.trim().slice(0, 160)).filter((name): name is string => Boolean(name)))].slice(0, 20) : [],
        stdoutTail: result.stdout.slice(-2000),
        stderrTail: result.stderr.slice(-2000),
      });
      if (!ok) {
        return {
          status: 200,
          body: {
            ok: false,
            summary: `repository check failed: ${check.id}`,
            evidence: { kind: "repository_checks", profile: "standard", checks: evidence },
          },
        };
      }
    }
    const diff = await run("git", ["diff", "--stat"]);
    const recordedAt = new Date().toISOString();
    const verifierId = `verifier:${workerId}`;
    return {
      status: 200,
      body: {
        ok: true,
        summary: "repository checks passed",
        evidence: {
          kind: "repository_checks",
          profile: "standard",
          checks: evidence,
          diffStat: diff.stdout.trim(),
          verifierId,
          sourceRevision: binding.sourceRevision,
          artifactDigest: binding.artifactDigest,
          verificationEvidence: required.map((check) => ({ check, verifierId, sourceRevision: binding.sourceRevision, artifactDigest: binding.artifactDigest, status: "passed", recordedAt })),
        },
      },
    };
  }
  return { status: 400, body: { ok: false, summary: "unsupported verification contract", blocker: "VERIFICATION_CONTRACT_UNSUPPORTED" } };
}

async function runBuild(body: Record<string, unknown>) {
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  const files = Array.isArray(body.files) ? body.files.filter((v): v is string => typeof v === "string").slice(0, 50) : [];
  const goalId = typeof body.goalId === "string" ? body.goalId : "";
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : "";
  const tddPhase = body.tddPhase === "red" || body.tddPhase === "green" ? body.tddPhase : undefined;
  if (!objective || !goalId || !attemptId || !strategyId) {
    return { status: 400, body: { ok: false, summary: "goalId, attemptId, strategyId and objective are required", blocker: "BUILDER_REQUEST_INVALID" } };
  }
  if (files.some((path) => !safeWorkspacePath(path))) {
    return { status: 400, body: { ok: false, summary: "requested file escapes builder workspace", blocker: "BUILDER_PATH_REJECTED" } };
  }
  const engine = await detectEngine();
  if (!engine) return { status: 503, body: { ok: false, summary: "No supported coding engine detected", blocker: "CODING_ENGINE_UNAVAILABLE" } };

  const prompt = [
    "You are a bounded code builder operating inside the current git workspace.",
    "Do not commit, push, merge, deploy, change credentials, or weaken tests/security.",
    "Implement only the requested objective. Preserve unrelated files.",
    `Goal=${goalId}`,
    `Attempt=${attemptId}`,
    `Strategy=${strategyId}`,
    `Objective=${objective.replace(/\s+/g, " ").trim()}`,
    files.length ? `PreferredFiles=${files.join(",")}` : "PreferredFiles=infer-smallest-safe-scope",
    `Context=${JSON.stringify(Array.isArray(body.context) ? body.context : []).replace(/\s+/g, " ").slice(0, 30_000)}`,
  ].join(" | ");

  const args = engine.id === "codex"
    ? [
        ...(process.platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : []),
        "exec",
        "--sandbox", "workspace-write",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "-",
      ]
    : ["--yes-always", "--message", prompt];
  const result = engine.id === "codex"
    ? await run(engine.command, args, executionTimeoutMs, prompt)
    : await run(engine.command, args);
  const diff = await run("git", ["diff", "--stat"]);
  const baseRevision = typeof body.baseRevision === "string" ? body.baseRevision : (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const snapshot = await candidateSnapshot(baseRevision);
  let tddEvidenceDigest: string | undefined;
  if (result.code === 0 && tddPhase === "red") {
    const red = await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["test"]);
    if (red.code === 0 || red.timedOut) {
      return { status: 422, body: { ok: false, summary: "TDD red phase did not produce a bounded failing test", blocker: "TDD_RED_NOT_PROVEN", evidence: { workerId, engine: engine.id, testExitCode: red.code, timedOut: red.timedOut } } };
    }
    tddEvidenceDigest = createHash("sha256").update(JSON.stringify({ exitCode: red.code, stdoutTail: red.stdout.slice(-4000), stderrTail: red.stderr.slice(-4000) })).digest("hex");
  }
  const combinedOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const transientEngineFailure = result.timedOut
    || /at capacity|rate limit|429|502|503|504|temporar|try again|overloaded|service unavailable/.test(combinedOutput);
  return {
    status: result.code === 0 ? 200 : 502,
    body: {
      ok: result.code === 0,
      summary: result.code === 0
        ? `${engine.id} completed bounded build`
        : result.timedOut
          ? `${engine.id} timed out after ${executionTimeoutMs}ms`
          : transientEngineFailure
            ? `${engine.id} temporarily unavailable with exit ${result.code}`
            : `${engine.id} failed with exit ${result.code}`,
      blocker: result.code === 0 || transientEngineFailure
        ? undefined
        : "CODING_ENGINE_FAILED",
      evidence: {
        workerId,
        engine: engine.id,
        exitCode: result.code,
        timedOut: result.timedOut,
        transientEngineFailure,
        timeoutMs: executionTimeoutMs,
        diffStat: diff.stdout.trim(),
        stdoutTail: result.stdout.slice(-4000),
        stderrTail: result.stderr.slice(-4000),
      },
      changedPaths: snapshot.changedPaths,
      patchDigest: snapshot.patchDigest,
      candidateRevision: snapshot.candidateRevision,
      artifactDigest: snapshot.artifactDigest,
      artifactRef: snapshot.artifactRef,
      tddPhase: tddPhase === "red" ? "red" : undefined,
      tddEvidenceDigest,
      requestedAuthority: [],
    },
  };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (!authorized(request)) return json(response, 401, { message: "unauthorized" });
    if (request.method === "GET" && url.pathname === "/health") {
      const engine = await detectEngine();
      return json(response, 200, { ok: true, service: "code-builder-worker", workerId, workspace, engine: engine?.id ?? null, inference: { locality: inferenceLocality, networkAccess: inferenceNetworkAccess }, capabilities: engine ? ["code-builder", "filesystem"] : ["filesystem"] });
    }
    if (request.method === "POST" && url.pathname === "/verify") {
      const result = await runVerify(await readJson(request));
      return json(response, result.status, result.body);
    }
    if (request.method !== "POST" || url.pathname !== "/build") return json(response, 404, { message: "not found" });
    const result = await runBuild(await readJson(request));
    return json(response, result.status, result.body);
  } catch (error) {
    return json(response, 500, { ok: false, summary: error instanceof Error ? error.message : String(error), blocker: "CODE_BUILDER_INTERNAL_ERROR" });
  }
}).listen(port, host, () => {
  console.log(`[code-builder] ${workerId} listening on http://${host}:${port}`);
});
