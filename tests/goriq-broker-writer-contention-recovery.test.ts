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
import { acquireResidentExecutionWriter } from "../src/orchestrator/resident-development-admission.ts";

test("Broker startup reclaims a persistently accepted Goal after a former live writer releases", { timeout: 22000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-writer-resume-"));
  const dbPath = join(root, "compass.sqlite");
  const compass = new CompassStore(dbPath);
  const goal = await new CompassGoalRegistryAdapter(compass).create({
    title: "Finish isolated development task in tests/fixtures/recovery-proof.txt",
    description: "Resume the same accepted Goal after brief writer contention",
    successCriteria: ["tests/fixtures/recovery-proof.txt is implemented"], constraints: [],
  });
  await new CompassWorkRunStore(compass).put(createQueuedWorkRun(goal.goalId));
  compass.close();
  const writer = await acquireResidentExecutionWriter(dbPath + ".cognitive-run.lock", goal.goalId);
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], {
    windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env, GITHUB_TOKEN: "", CODE_BUILDER_LOCAL_URL: "", CODE_BUILDER_LOCAL_TOKEN: "",
      JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
      JARVIS_OWNER_TOKEN: "writer-recovery-fixture", JARVIS_DB_PATH: join(root, "broker.sqlite"),
      JARVIS_COMPASS_DB_PATH: dbPath, JARVIS_PUBLIC_BROKER_URL: "",
      JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "",
    },
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  let writerHeld = true;
  try {
    const address = "http://127.0.0.1:" + port;
    const headers = { Authorization: "Bearer writer-recovery-fixture" };
    let healthy = false;
    for (let n = 0; n < 120; n++) {
      try {
        healthy = (await fetch(address + "/health", { signal: AbortSignal.timeout(500) })).ok;
        if (healthy) break;
      } catch { /* bounded broker start */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(healthy, true, "Broker did not start: " + stderr);
    // Keep the real existing local writer alive long enough to force a losing
    // executor. Neither the old writer nor the contender may modify WorkRun.
    await new Promise(resolve => setTimeout(resolve, 2400));
    const status = address + "/api/jarvis/admin/work/" + encodeURIComponent(goal.goalId);
    const competing = await fetch(status, { headers });
    assert.equal(competing.status, 200);
    assert.equal(((await competing.json()) as { run: { phase: string } }).run.phase, "QUEUED");
    await writer.release(); writerHeld = false;
    let phase = "QUEUED";
    for (let n = 0; n < 75; n++) {
      const result = await fetch(status, { headers, signal: AbortSignal.timeout(1000) });
      if (result.ok) phase = ((await result.json()) as { run: { phase: string } }).run.phase;
      if (phase === "BLOCKED") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(phase, "BLOCKED",
      "No authenticated Goal continuation after former writer release: " + stderr);
  } finally {
    if (writerHeld) await writer.release();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill(); await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
