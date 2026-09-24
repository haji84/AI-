import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";

type BridgeReceipt = { accepted: boolean; goalId: string; action: string; executionScheduled: boolean };
type BridgeStatus = { run: { runId: string; goalId: string; phase: string; blockers: string[] } };
type BridgeEvent = { id: string; goalId: string; type: string; summary: string };

// On the self-hosted Windows runner, make loopback requests independently of
// any ambient proxy. Auth stays local and never enters the uploaded evidence.
function localRequest<T = unknown>(base: string, path: string, token: string, body?: unknown): Promise<{ status: number; data: T }> {
  const url = new URL(path, base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Bridge E2E requires loopback");
  return new Promise((done, fail) => {
    const request = httpRequest(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      timeout: 5000,
    }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try { done({ status: response.statusCode ?? 500, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as T }); }
        catch (error) { fail(error); }
      });
    });
    request.once("timeout", () => request.destroy(new Error("Bridge request timed out")));
    request.once("error", fail);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function freePort(): Promise<number> {
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(done => socket.close(() => done()));
  return port;
}

export async function runZbookDirectGoalBridgeE2E(testWorkspace: string, builderToken: string): Promise<Record<string, unknown>> {
  if (process.platform !== "win32") throw new Error("Physical ZBook Bridge E2E requires Windows");
  if (!builderToken) throw new Error("Local Builder token is required");
  const root = await mkdtemp(join(tmpdir(), "goriq-zbook-bridge-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("hex");
  const fixture = "tests/fixtures/autonomous-builder-e2e.txt";
  const target = resolve(testWorkspace, fixture);
  const evidence: Record<string, unknown> = { environment: "ZBook Windows local Broker + real Codex Builder", startedAt: new Date().toISOString(), restartCount: 0 };
  let broker: ChildProcess | null = null;
  let stderr = "";
  const get = <T = unknown>(path: string) => localRequest<T>(base, path, token);
  const start = async () => {
    broker = spawn(process.execPath, [resolve("scripts/jarvis-broker.ts")], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: token,
        JARVIS_DB_PATH: join(root, "state.sqlite"), JARVIS_COMPASS_DB_PATH: join(root, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "",
        JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "", CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796", CODE_BUILDER_LOCAL_TOKEN: builderToken },
    });
    broker.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-12000); });
    for (let i = 0; i < 100; i++) {
      try { if ((await get("/health")).status === 200) return; } catch { /* startup */ }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Local Broker did not start: ${stderr.slice(-2000)}`);
  };
  const stop = async () => {
    if (broker && broker.exitCode === null && broker.signalCode === null) {
      const exited = once(broker, "exit"); broker.kill(); await exited;
    }
    broker = null;
  };
  try {
    await writeFile(target, "baseline\n", "utf8");
    await start();
    const payload = {
      text: `Complete code in ${fixture}. Make its complete content exactly: beta.`,
      goalContract: { successCriteria: [`Implement code in ${fixture} with complete content exactly beta`], constraints: [`Only change ${fixture}`] },
      idempotencyKey: "zbook-physical-bridge-e2e",
    };
    const first = await localRequest<BridgeReceipt>(base, "/api/jarvis/admin/work", token, payload);
    if (first.status !== 202 || !first.data?.accepted || !first.data?.goalId || !first.data?.executionScheduled) throw new Error(`Bridge intake failed: ${JSON.stringify(first.data)}`);
    const receipt = first.data as BridgeReceipt;
    const duplicate = await localRequest<BridgeReceipt>(base, "/api/jarvis/admin/work", token, payload);
    if (duplicate.status !== 202 || duplicate.data?.goalId !== receipt.goalId) throw new Error("Idempotent replay created another Goal");
    const before = await get<BridgeStatus>(`/api/jarvis/admin/work/${encodeURIComponent(receipt.goalId)}`);
    if (before.status !== 200 || before.data?.run?.goalId !== receipt.goalId) throw new Error("Durable status unavailable immediately after acceptance");
    evidence.intake = { goalId: receipt.goalId, action: receipt.action, duplicateGoalId: duplicate.data.goalId, runId: before.data.run.runId, initialPhase: before.data.run.phase };
    if (["COMPLETED", "BLOCKED", "HUMAN_GATE"].includes(before.data.run.phase)) throw new Error("Goal terminated before restart interruption could be verified");
    await stop();
    evidence.restartCount = 1;
    await start();
    let final: BridgeStatus | null = null;
    let events: BridgeEvent[] = [];
    for (let i = 0; i < 480; i++) {
      const status = await get<BridgeStatus>(`/api/jarvis/admin/work/${encodeURIComponent(receipt.goalId)}`);
      const pending = await get<{ events: BridgeEvent[] }>(`/api/jarvis/admin/bridge/events?goalId=${encodeURIComponent(receipt.goalId)}`);
      if (status.status !== 200 || pending.status !== 200) throw new Error("Status or event read failed after restart");
      final = status.data as BridgeStatus;
      events = pending.data.events as BridgeEvent[];
      if (["COMPLETED", "BLOCKED", "HUMAN_GATE"].includes(final.run.phase) && events.some(e => e.goalId === receipt.goalId)) break;
      await new Promise(done => setTimeout(done, 1000));
    }
    evidence.final = { run: final?.run, events: events.map(e => ({ id: e.id, type: e.type, summary: e.summary })) };
    evidence.fixtureValue = (await readFile(target, "utf8")).trim();
    if (final?.run.runId !== before.data.run.runId) throw new Error("Restart created a duplicate Work Run");
    if (final?.run.phase !== "COMPLETED" || evidence.fixtureValue !== "beta" || !events.some(e => e.type === "GOAL_COMPLETED")) {
      const db = new CompassStore(join(root, "compass.sqlite"));
      try {
        const state = db.getState();
        const work = await new CompassWorkStateStoreAdapter(db).get(receipt.goalId);
        evidence.diagnostic = { state: { status: state.status, nextAction: state.nextAction, blockers: state.blockers }, work: work && { status: work.status, blockers: work.blockers, verificationResults: work.verificationResults.map(r => ({ itemId: r.itemId, passed: r.passed })), nextAction: work.nextAction } };
      } finally { db.close(); }
      throw new Error(`Physical Goal did not complete through Bridge: ${JSON.stringify({ final: evidence.final, fixtureValue: evidence.fixtureValue, diagnostic: evidence.diagnostic })} stderr=${stderr.slice(-2000)}`);
    }
    evidence.status = "GOAL_ACHIEVED";
    evidence.completedAt = new Date().toISOString();
    return evidence;
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}
