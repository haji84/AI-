import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { changedPaths, newPathsSinceBaseline, terminalWorkPhase } from "./zbook-goal-git-status.ts";

if (process.platform !== "win32") throw new Error("Issue #1218 physical Bridge run requires ZBook Windows");
const workspace = process.env.GORIQ_1218_WORKSPACE?.trim();
if (!workspace || !process.env.CODE_BUILDER_LOCAL_TOKEN?.trim()) throw new Error("Isolated workspace and local Builder are required");
const root = resolve(process.env.LOCALAPPDATA ?? "", "GAIWorker", "goal-1218-bridge-state");
const evidenceDir = resolve(".gai-results");
const ownerToken = randomBytes(32).toString("hex");
const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
const port = (socket.address() as { port: number }).port;
await new Promise<void>(done => socket.close(() => done()));
const base = `http://127.0.0.1:${port}`;
let broker: ChildProcess | null = null;
let stderr = "";
const evidence: Record<string, unknown> = { issue: 1218, source: "authenticated Direct Goal Bridge on ZBook", startedAt: new Date().toISOString() };

function request(path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = new URL(path, base);
  return new Promise((done, fail) => {
    const req = httpRequest(url, { method: body === undefined ? "GET" : "POST", timeout: 5000,
      headers: { Authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        try { done({ status: res.statusCode ?? 500, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> }); }
        catch (error) { fail(error); }
      });
    });
    req.once("timeout", () => req.destroy(new Error("Bridge timeout")));
    req.once("error", fail);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

try {
  await mkdir(root, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const baselinePaths = changedPaths(execFileSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8", windowsHide: true }));
  broker = spawn(process.execPath, [resolve("scripts/jarvis-broker.ts")], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, GITHUB_TOKEN: "", JARVIS_OWNER_TOKEN: ownerToken, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
      JARVIS_DB_PATH: join(root, "state.sqlite"), JARVIS_COMPASS_DB_PATH: join(root, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" },
  });
  broker.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { if ((await request("/health")).status === 200) { ready = true; break; } } catch { /* bounded startup */ }
    await new Promise(done => setTimeout(done, 100));
  }
  if (!ready) throw new Error("Local Broker failed to start");
  const payload = {
    idempotencyKey: "issue-1218-zbook-bridge-v1",
    text: "Issue #1218: Implement an owner-local Windows utility in scripts/owner-code-windows.ps1 for the existing DPAPI Production Owner login code. Default masked; explicit reveal and local clipboard copy with confirmation. Use scripts/read-jarvis-production-config.ps1 and existing production config path. Update src/app/jarvis/OwnerLogin.tsx recovery wording. Add tests. Never print or upload the code; do not rotate any actual credential or change Worker enrollment. Complete the implementation and independent tests, stopping at any separate Human Gate for rotation.",
    goalContract: { successCriteria: [
      "Implement owner-local masked reveal and copy utility in scripts/owner-code-windows.ps1 without exposing other tokens",
      "Implement clear recovery wording in src/app/jarvis/OwnerLogin.tsx",
      "Tests verify wrong identity fails closed and no secret appears in output or artifacts",
    ], constraints: ["Only modify the isolated repository clone", "Do not rotate any actual Production credential", "Preserve all Human Gates and Worker identities"] },
  };
  const accepted = await request("/api/jarvis/admin/work", payload);
  if (accepted.status !== 202 || accepted.data.accepted !== true || typeof accepted.data.goalId !== "string" || accepted.data.executionScheduled !== true) {
    throw new Error(`Bridge did not accept and schedule #1218: HTTP ${accepted.status}`);
  }
  const goalId = accepted.data.goalId;
  const duplicate = await request("/api/jarvis/admin/work", payload);
  if (duplicate.status !== 202 || duplicate.data.goalId !== goalId) throw new Error("#1218 replay created another Goal");
  evidence.intake = { goalId, action: accepted.data.action, executionScheduled: true, duplicateGoalId: duplicate.data.goalId };
  let observedExecution = false;
  let lastChanges: string[] = [];
  for (let n = 0; n < 1200; n++) {
    const status = await request(`/api/jarvis/admin/work/${encodeURIComponent(goalId)}`);
    if (status.status !== 200) throw new Error("#1218 status unavailable");
    const run = status.data.run as { phase?: string; blockers?: string[]; nextAction?: string } | undefined;
    if (run?.phase && run.phase !== "QUEUED") observedExecution = true;
    const changes = changedPaths(execFileSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8", windowsHide: true }));
    if (changes.length) lastChanges = changes;
    evidence.lastPhase = run?.phase ?? null;
    if (terminalWorkPhase(run?.phase)) {
      evidence.changedFiles = changes.length ? changes : lastChanges;
      evidence.blockers = run?.blockers ?? [];
      evidence.nextAction = run?.nextAction ?? null;
      break;
    }
    await new Promise(done => setTimeout(done, 1000));
  }
  evidence.changedFiles ??= lastChanges;
  evidence.autoExecutionObserved = observedExecution;
  for (let n = 0; n < 10; n++) {
    const events = await request(`/api/jarvis/admin/bridge/events?goalId=${encodeURIComponent(goalId)}`);
    evidence.events = Array.isArray(events.data.events) ? (events.data.events as { type: string; summary: string }[]).map(e => ({ type: e.type, summary: e.summary })) : [];
    if ((evidence.events as { type: string }[]).some(event => ["GOAL_COMPLETED", "GOAL_BLOCKED", "HUMAN_REQUIRED"].includes(event.type))) break;
    await new Promise(done => setTimeout(done, 200));
  }
  const paths = (evidence.changedFiles as string[] | undefined) ?? [];
  if (!terminalWorkPhase(evidence.lastPhase as string | undefined)) throw new Error("#1218 remained nonterminal after bounded observation");
  const newlyChanged = newPathsSinceBaseline(baselinePaths, paths);
  const inScope = (path: string) => /^(scripts|tests|src\/app\/jarvis)\//.test(path) || path === "docs/jarvis-reverse-traceability.json";
  if (newlyChanged.some(path => !inScope(path))) throw new Error("Builder changed a file outside the bounded #1218 scope");
  const patchPaths = paths.filter(inScope);
  if (patchPaths.length) {
    execFileSync("git", ["add", "-N", "--", ...patchPaths], { cwd: workspace, windowsHide: true });
    const patch = execFileSync("git", ["diff", "--binary", "--", ...patchPaths], { cwd: workspace, encoding: "utf8", windowsHide: true, maxBuffer: 2_000_000 });
    await writeFile(join(evidenceDir, "goal-1218-bridge.patch"), patch, "utf8");
  }
  if (!observedExecution) throw new Error("#1218 accepted but autonomous execution was not observed");
  if (!paths.length) throw new Error(`#1218 started but no implementation patch was produced (phase=${evidence.lastPhase})`);
  if (evidence.lastPhase !== "COMPLETED") throw new Error(`#1218 stopped at ${evidence.lastPhase}; inspect blockers and gate`);
  evidence.status = "GOAL_COMPLETED";
} catch (error) {
  evidence.status = "FAILED";
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (broker && broker.exitCode === null && broker.signalCode === null) { const exited = once(broker, "exit"); broker.kill(); await exited; }
  evidence.completedAt = new Date().toISOString();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "goal-1218-bridge.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(evidence) + "\n");
}
