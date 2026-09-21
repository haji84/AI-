import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { resolve, relative, isAbsolute } from "node:path";

const host = process.env.CODE_BUILDER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.CODE_BUILDER_PORT || 8796);
const token = process.env.CODE_BUILDER_TOKEN?.trim() || "";
const workspace = resolve(process.env.CODE_BUILDER_WORKSPACE?.trim() || process.cwd());
const workerId = process.env.GAI_WORKER_ID?.trim() || hostname();
const explicitEngine = process.env.CODE_BUILDER_ENGINE?.trim() || "";

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

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((done) => {
    const child = spawn(probe, [command], { stdio: "ignore", windowsHide: true });
    child.once("error", () => done(false));
    child.once("exit", (code) => done(code === 0));
  });
}

async function detectEngine(): Promise<{ id: string; command: string } | null> {
  const candidates = explicitEngine ? [explicitEngine] : ["codex", "aider"];
  for (const command of candidates) if (await commandExists(command)) return { id: command, command };
  return null;
}

function safeWorkspacePath(path: string): boolean {
  const full = resolve(workspace, path);
  const rel = relative(workspace, full);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function run(command: string, args: string[], timeoutMs = 600_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: workspace, windowsHide: true, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk).slice(0, 100_000); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 100_000); });
    child.once("error", (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr: String(error) }); });
    child.once("exit", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}

async function runBuild(body: Record<string, unknown>) {
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  const files = Array.isArray(body.files) ? body.files.filter((v): v is string => typeof v === "string").slice(0, 50) : [];
  const goalId = typeof body.goalId === "string" ? body.goalId : "";
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : "";
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
    `Goal: ${goalId}`,
    `Attempt: ${attemptId}`,
    `Strategy: ${strategyId}`,
    `Objective: ${objective}`,
    files.length ? `Preferred files: ${files.join(", ")}` : "Preferred files: infer the smallest safe scope.",
    `Context: ${JSON.stringify(Array.isArray(body.context) ? body.context : []).slice(0, 30_000)}`,
  ].join("\n");

  const args = engine.id === "codex"
    ? ["exec", "--full-auto", "--sandbox", "workspace-write", prompt]
    : ["--yes-always", "--message", prompt];
  const result = await run(engine.command, args);
  const diff = await run("git", ["diff", "--stat"]);
  return {
    status: result.code === 0 ? 200 : 502,
    body: {
      ok: result.code === 0,
      summary: result.code === 0 ? `${engine.id} completed bounded build` : `${engine.id} failed with exit ${result.code}`,
      blocker: result.code === 0 ? undefined : "CODING_ENGINE_FAILED",
      evidence: { workerId, engine: engine.id, exitCode: result.code, diffStat: diff.stdout.trim(), stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000) },
    },
  };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (!authorized(request)) return json(response, 401, { message: "unauthorized" });
    if (request.method === "GET" && url.pathname === "/health") {
      const engine = await detectEngine();
      return json(response, 200, { ok: true, service: "code-builder-worker", workerId, workspace, engine: engine?.id ?? null, capabilities: engine ? ["code-builder", "filesystem"] : ["filesystem"] });
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
