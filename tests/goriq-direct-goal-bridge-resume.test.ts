import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";

test("Broker startup resumes accepted Work Run and publishes machine-readable blocker", { timeout: 45000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-resume-"));
  const compassPath = join(dir, "compass.sqlite");
  const db = new CompassStore(compassPath);
  const active = await new CompassGoalRegistryAdapter(db).create({
    title: "Complete code in tests/fixtures/autonomous-builder-e2e.txt",
    description: "Make its complete content exactly: beta",
    successCriteria: ["tests/fixtures/autonomous-builder-e2e.txt contains beta"], constraints: [],
  });
  await new CompassWorkRunStore(db).put(createQueuedWorkRun(active.goalId));
  db.close();
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
  const child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], {
    env: { ...process.env, GITHUB_TOKEN: "", CODE_BUILDER_LOCAL_URL: "", CODE_BUILDER_LOCAL_TOKEN: "", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: "resume-test-owner", JARVIS_DB_PATH: join(dir, "state.sqlite"), JARVIS_COMPASS_DB_PATH: compassPath, JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  });
  let stderr = ""; child.stderr?.on("data", chunk => { stderr += String(chunk); });
  try {
    const base = `http://127.0.0.1:${port}/api/jarvis/admin`;
    const headers = { Authorization: "Bearer resume-test-owner" };
    let phase = "QUEUED", events: { type: string }[] = [];
    for (let n = 0; n < 180; n++) {
      try {
        const status = await fetch(`${base}/work/${encodeURIComponent(active.goalId)}`, { headers, signal: AbortSignal.timeout(1000) });
        if (status.ok) phase = ((await status.json()) as { run: { phase: string } }).run.phase;
        const response = await fetch(`${base}/bridge/events?goalId=${encodeURIComponent(active.goalId)}`, { headers, signal: AbortSignal.timeout(1000) });
        if (response.ok) events = ((await response.json()) as { events: { type: string }[] }).events;
        if (phase === "BLOCKED" && events.some(e => e.type === "GOAL_BLOCKED")) break;
      } catch { /* bounded startup and execution polling */ }
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(phase, "BLOCKED", `persisted run did not resume: ${stderr.slice(-6000)}`);
    assert.ok(events.some(e => e.type === "GOAL_BLOCKED"));
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    rmSync(dir, { recursive: true, force: true });
  }
});
