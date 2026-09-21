import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { basename, extname, join, resolve, relative, isAbsolute } from "node:path";

const host = process.env.CODE_BUILDER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.CODE_BUILDER_PORT || 8796);
const token = process.env.CODE_BUILDER_TOKEN?.trim() || "";
const workspace = resolve(process.env.CODE_BUILDER_WORKSPACE?.trim() || process.cwd());
const workerId = process.env.GAI_WORKER_ID?.trim() || hostname();
const explicitEngine = process.env.CODE_BUILDER_ENGINE?.trim() || "";
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

function run(command: string, args: string[], timeoutMs = executionTimeoutMs, stdinText?: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((done) => {
    const extension = extname(command).toLowerCase();
    const invocation = process.platform === "win32" && extension === ".ps1"
      ? { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args] }
      : process.platform === "win32" && (extension === ".cmd" || extension === ".bat")
        ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
        : { command, args };
    const child = spawn(invocation.command, invocation.args, { cwd: workspace, windowsHide: true, shell: false, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk).slice(0, 100_000); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 100_000); });
    child.once("error", (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr: String(error), timedOut }); });
    child.stdin?.end(stdinText ?? "");
    child.once("exit", (code) => { clearTimeout(timer); done({ code, stdout, stderr, timedOut }); });
  });
}

type ProposedFile = { path: string; content: string };

function parseProposal(raw: string): ProposedFile[] {
  const parsed = JSON.parse(raw) as { files?: unknown };
  if (!Array.isArray(parsed.files)) throw new Error("Codex proposal must contain files[]");
  return parsed.files.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid proposed file entry");
    const value = item as { path?: unknown; content?: unknown };
    if (typeof value.path !== "string" || typeof value.content !== "string") throw new Error("Proposed file requires path and content");
    return { path: value.path, content: value.content };
  });
}

async function buildWithCodexProposal(engine: { id: string; command: string }, body: Record<string, unknown>, files: string[], objective: string, goalId: string, attemptId: string, strategyId: string) {
  if (files.length === 0) {
    return { status: 400, body: { ok: false, summary: "Codex Builder requires an explicit file allowlist", blocker: "BUILDER_FILE_ALLOWLIST_REQUIRED" } };
  }

  const allowed = new Set(files);
  const snapshots: Array<{ path: string; content: string }> = [];
  for (const path of files) {
    const full = resolve(workspace, path);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic-link target: ${path}`);
    snapshots.push({ path, content: await readFile(full, "utf8") });
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "jarvis-code-builder-"));
  const schemaPath = join(tempRoot, "proposal-schema.json");
  const outputPath = join(tempRoot, "proposal.json");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    },
    required: ["files"],
  };

  const prompt = [
    "You are a bounded code-generation engine. Do not edit files or run commands.",
    "Return only the structured file replacements required to satisfy the objective.",
    "You may modify only AllowedFiles. Preserve every unrelated file.",
    `Goal=${goalId}`,
    `Attempt=${attemptId}`,
    `Strategy=${strategyId}`,
    `Objective=${objective.replace(/\s+/g, " ").trim()}`,
    `AllowedFiles=${JSON.stringify(files)}`,
    `CurrentFiles=${JSON.stringify(snapshots).slice(0, 100_000)}`,
    `Context=${JSON.stringify(Array.isArray(body.context) ? body.context : []).slice(0, 30_000)}`,
  ].join("\n");

  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    const args = [
      "exec",
      "--sandbox", "read-only",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "-",
    ];
    const result = await run(engine.command, args, executionTimeoutMs, prompt);
    if (result.code !== 0) {
      return {
        status: 502,
        body: {
          ok: false,
          summary: `codex proposal failed with exit ${result.code}`,
          blocker: "CODING_ENGINE_FAILED",
          evidence: { workerId, engine: engine.id, exitCode: result.code, timedOut: result.timedOut, timeoutMs: executionTimeoutMs, stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000) },
        },
      };
    }

    const proposal = parseProposal(await readFile(outputPath, "utf8"));
    if (proposal.length === 0) throw new Error("Codex proposal returned no files");
    for (const proposed of proposal) {
      if (!allowed.has(proposed.path)) throw new Error(`Codex proposed non-allowlisted path: ${proposed.path}`);
      if (!safeWorkspacePath(proposed.path)) throw new Error(`Codex proposed unsafe path: ${proposed.path}`);
      if (Buffer.byteLength(proposed.content, "utf8") > 1_000_000) throw new Error(`Codex proposed oversized content: ${proposed.path}`);
    }
    for (const proposed of proposal) {
      await writeFile(resolve(workspace, proposed.path), proposed.content, "utf8");
    }
    const diff = await run("git", ["diff", "--stat"]);
    return {
      status: 200,
      body: {
        ok: true,
        summary: "codex proposed and JARVIS applied bounded file replacements",
        evidence: {
          workerId,
          engine: engine.id,
          executionMode: "codex-read-only-proposal-jarvis-apply",
          proposalPaths: proposal.map((item) => item.path),
          diffStat: diff.stdout.trim(),
          stdoutTail: result.stdout.slice(-2000),
          stderrTail: result.stderr.slice(-2000),
        },
      },
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
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
  if (engine.id === "codex") return buildWithCodexProposal(engine, body, files, objective, goalId, attemptId, strategyId);

  const prompt = [
    "You are a bounded code builder operating inside the current git workspace.",
    "Do not commit, push, merge, deploy, change credentials, or weaken tests/security.",
    "Implement only the requested objective. Preserve unrelated files.",
    `Goal=${goalId}`,
    `Attempt=${attemptId}`,
    `Strategy=${strategyId}`,
    `Objective=${objective.replace(/\s+/g, " ").trim()}`,
    files.length ? `PreferredFiles=${files.join(",")}` : "PreferredFiles=infer-smallest-safe-scope",
  ].join(" | ");
  const result = await run(engine.command, ["--yes-always", "--message", prompt]);
  const diff = await run("git", ["diff", "--stat"]);
  return {
    status: result.code === 0 ? 200 : 502,
    body: {
      ok: result.code === 0,
      summary: result.code === 0 ? `${engine.id} completed bounded build` : `${engine.id} failed with exit ${result.code}`,
      blocker: result.code === 0 ? undefined : "CODING_ENGINE_FAILED",
      evidence: { workerId, engine: engine.id, exitCode: result.code, timedOut: result.timedOut, timeoutMs: executionTimeoutMs, diffStat: diff.stdout.trim(), stdoutTail: result.stdout.slice(-4000), stderrTail: result.stderr.slice(-4000) },
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
