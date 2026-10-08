import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";

const script = "scripts/goriq-node-loss-rejoin-e2e.mjs";

async function json(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("rejoin evidence requires survivor execution between loss and recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "goriq-node-loss-"));
  try {
    const loss = join(dir, "loss.json");
    const recovery = join(dir, "recovery.json");
    const status = join(dir, "status.json");
    const survivor = join(dir, "survivor.json");
    const output = join(dir, "out.json");

    await json(loss, {
      version: 1,
      runId: "run-1",
      node: "macbook",
      oldPid: 100,
      oldStartedAt: "Tue Sep 30 00:00:00 2026",
      lossObservedAt: "2026-09-30T00:00:00.000Z",
    });
    await json(survivor, {
      sourceSha: "sha",
      direction: "macbook-to-zbook",
      origin: "macbook",
      target: "zbook",
      targetPlatform: "win32",
      targetRunnerName: "ZBook",
      reclaimedTasks: 2,
      tasks: [
        { migrationClass: "MIGRATABLE", oldEpoch: 1, newEpoch: 2, staleClaimRejected: true, checkpointPreserved: true, completedBy: "zbook" },
        { migrationClass: "RESTARTABLE", oldEpoch: 1, newEpoch: 2, staleClaimRejected: true, checkpointPreserved: true, completedBy: "zbook" },
      ],
      verifiedAt: "2026-09-30T00:00:10.000Z",
    });
    await json(recovery, {
      version: 1,
      runId: "run-1",
      node: "macbook",
      newPid: 100,
      newStartedAt: "Tue Sep 30 00:00:15 2026",
      recoveredAt: "2026-09-30T00:00:20.000Z",
    });
    await json(status, {
      workerId: "macbook",
      runnerHealthy: true,
      runnerConnectionHealthy: false,
      runnerProtectedByActiveJob: true,
      activeRunnerWorkers: 1,
      consecutiveRunnerFailures: 0,
      runnerRecoveryDeferred: false,
      checkedAt: "2026-09-30T00:00:19.000Z",
    });

    const result = spawnSync(process.execPath, [
      script,
      "--phase", "rejoin",
      "--node", "macbook",
      "--platform", "darwin",
      "--sha", "sha",
      "--loss", loss,
      "--recovery", recovery,
      "--status", status,
      "--survivor", survivor,
      "--output", output,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(await readFile(output, "utf8"));
    assert.equal(parsed.verdict, "PASS");
    assert.equal(parsed.survivingNodeExecutedBeforeRecovery, true);
    assert.equal(parsed.watchdogRecovered, true);
    assert.equal(parsed.oldListenerPid, 100);
    assert.equal(parsed.newListenerPid, 100);
    assert.equal(parsed.listenerProcessIdentityChanged, true);
    assert.equal(parsed.oldListenerStartedAt, "Tue Sep 30 00:00:00 2026");
    assert.equal(parsed.newListenerStartedAt, "Tue Sep 30 00:00:15 2026");
    assert.equal(parsed.runnerConnectionEvidenceMode, "active-runner-worker");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("destructive Stage B node-loss workflow is manual-only", async () => {
  const workflow = await readFile(".github/workflows/goriq-stage-b-node-loss-rejoin.yml", "utf8");
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:\s*\n/);
});


test("Stage B rejoin proof uses fresh live runner process status on both nodes", async () => {
  const workflow = await readFile(".github/workflows/goriq-stage-b-node-loss-rejoin.yml", "utf8");
  assert.match(workflow, /macbook-live-status\.json/);
  assert.match(workflow, /zbook-live-status\.json/);
  assert.match(workflow, /runnerProtectedByActiveJob/);
  assert.match(workflow, /activeRunnerWorkers/);
  assert.match(workflow, /Runner\.Worker parent is not Runner\.Listener/);
  assert.match(workflow, /oldStartedAt/);
  assert.match(workflow, /newStartedAt/);
  assert.match(workflow, /listenerStartedAt/);
  assert.doesNotMatch(workflow, /--status "\$STATE_ROOT\/macbook-watchdog-status\.json"/);
  assert.doesNotMatch(workflow, /--status \(Join-Path \$stateRoot 'zbook-watchdog-status\.json'\)/);
});


test("Stage B rejoin proof binds to the current job ancestry instead of arbitrary workers", async () => {
  const workflow = await readFile(".github/workflows/goriq-stage-b-node-loss-rejoin.yml", "utf8");

  assert.match(workflow, /Mac rejoin ancestry:/);
  assert.match(workflow, /current_pid="\$PPID"/);
  assert.match(workflow, /current_comm=.*ps -o comm=/);
  assert.doesNotMatch(workflow, /worker_pid="\$\(pgrep -f 'Runner\.Worker' \| head -n 1/);

  assert.match(workflow, /ZBook rejoin ancestry:/);
  assert.match(workflow, /\$currentPid = \$PID/);
  assert.match(workflow, /Current ZBook job ancestry does not contain Runner\.Worker\.exe/);
  assert.doesNotMatch(workflow, /\$worker = \$workers \| Select-Object -First 1/);

  assert.doesNotMatch(workflow, /& \$watchdog -RunnerRoot/);
  assert.doesNotMatch(workflow, /\/bin\/bash "\$WATCHDOG" >\/dev\/null 2>&1 \|\| true/);
});


test("rejoin evidence accepts UTF-8 BOM-prefixed Windows JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "goriq-node-loss-bom-"));
  try {
    const loss = join(dir, "loss.json");
    const recovery = join(dir, "recovery.json");
    const status = join(dir, "status.json");
    const survivor = join(dir, "survivor.json");
    const output = join(dir, "out.json");

    const writeBomJson = async (path, value) => {
      await writeFile(path, "\uFEFF" + JSON.stringify(value, null, 2) + "\n", "utf8");
    };

    await writeBomJson(loss, {
      version: 1,
      runId: "run-bom",
      node: "zbook",
      oldPid: 10,
      oldStartedAt: "2026-09-30T00:00:00.000Z",
      lossObservedAt: "2026-09-30T00:00:00.000Z",
    });
    await writeBomJson(recovery, {
      version: 1,
      runId: "run-bom",
      node: "zbook",
      newPid: 20,
      newStartedAt: "2026-09-30T00:00:20.000Z",
      recoveredAt: "2026-09-30T00:00:20.000Z",
    });
    await writeBomJson(status, {
      workerId: "zbook",
      runnerHealthy: true,
      runnerConnectionHealthy: false,
      runnerProtectedByActiveJob: true,
      activeRunnerWorkers: 1,
      consecutiveRunnerFailures: 0,
      runnerRecoveryDeferred: false,
      checkedAt: "2026-09-30T00:00:19.000Z",
    });
    await json(survivor, {
      sourceSha: "sha",
      direction: "zbook-to-macbook",
      origin: "zbook",
      target: "macbook",
      targetPlatform: "darwin",
      targetRunnerName: "MacBook",
      reclaimedTasks: 2,
      tasks: [
        { migrationClass: "MIGRATABLE", oldEpoch: 1, newEpoch: 2, staleClaimRejected: true, checkpointPreserved: true, completedBy: "macbook" },
        { migrationClass: "RESTARTABLE", oldEpoch: 1, newEpoch: 2, staleClaimRejected: true, checkpointPreserved: true, completedBy: "macbook" },
      ],
      verifiedAt: "2026-09-30T00:00:10.000Z",
    });

    const result = spawnSync(process.execPath, [
      script,
      "--phase", "rejoin",
      "--node", "zbook",
      "--platform", "win32",
      "--sha", "sha",
      "--loss", loss,
      "--recovery", recovery,
      "--status", status,
      "--survivor", survivor,
      "--output", output,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(await readFile(output, "utf8"));
    assert.equal(parsed.verdict, "PASS");
    assert.equal(parsed.lostNode, "zbook");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
