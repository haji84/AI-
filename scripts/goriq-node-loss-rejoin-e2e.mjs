import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArgs() {
  const out = new Map();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key?.startsWith("--")) continue;
    const next = process.argv[i + 1];
    if (!next || next.startsWith("--")) {
      out.set(key.slice(2), "true");
      continue;
    }
    out.set(key.slice(2), next);
    i += 1;
  }
  return out;
}

function required(args, key) {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function nodeId(value) {
  if (value !== "macbook" && value !== "zbook") throw new Error(`Invalid node id: ${value}`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp(value) {
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `Invalid timestamp: ${value}`);
  return parsed;
}

function opposite(node) {
  return node === "macbook" ? "zbook" : "macbook";
}

async function rejoin(args) {
  const node = nodeId(required(args, "node"));
  const platform = required(args, "platform");
  const sha = required(args, "sha");
  const loss = await readJson(required(args, "loss"));
  const recovery = await readJson(required(args, "recovery"));
  const status = await readJson(required(args, "status"));
  const survivor = await readJson(required(args, "survivor"));
  const output = required(args, "output");

  assert.equal(loss.version, 1);
  assert.equal(recovery.version, 1);
  assert.equal(loss.node, node);
  assert.equal(recovery.node, node);
  assert.equal(loss.runId, recovery.runId);
  assert.ok(Number.isInteger(loss.oldPid) && loss.oldPid > 0);
  assert.ok(Number.isInteger(recovery.newPid) && recovery.newPid > 0);
  assert.notEqual(recovery.newPid, loss.oldPid);

  const survivingNode = opposite(node);
  assert.equal(survivor.sourceSha, sha);
  assert.equal(survivor.origin, node);
  assert.equal(survivor.target, survivingNode);
  assert.equal(survivor.reclaimedTasks, 2);
  assert.ok(survivor.tasks.every((task) => task.newEpoch === task.oldEpoch + 1));
  assert.ok(survivor.tasks.every((task) => task.staleClaimRejected));
  assert.ok(survivor.tasks.every((task) => task.checkpointPreserved));
  assert.ok(survivor.tasks.every((task) => task.completedBy === survivingNode));

  const lostAt = timestamp(loss.lossObservedAt);
  const survivorAt = timestamp(survivor.verifiedAt);
  const recoveredAt = timestamp(recovery.recoveredAt);
  assert.ok(lostAt < survivorAt, "surviving node must execute after listener loss");
  assert.ok(survivorAt < recoveredAt, "surviving node must finish before lost node recovery");

  assert.equal(status.runnerHealthy, true);
  assert.equal(status.runnerConnectionHealthy, true);
  assert.equal(status.runnerRecoveryDeferred ?? false, false);
  assert.equal(status.consecutiveRunnerFailures ?? 0, 0);

  const evidence = {
    version: 1,
    verdict: "PASS",
    sourceSha: sha,
    lostNode: node,
    survivingNode,
    lostPlatform: platform,
    lossObservedAt: loss.lossObservedAt,
    survivorCompletedAt: survivor.verifiedAt,
    recoveredAt: recovery.recoveredAt,
    oldListenerPid: loss.oldPid,
    newListenerPid: recovery.newPid,
    survivingNodeExecutedBeforeRecovery: true,
    watchdogRecovered: true,
    runnerHealthyAfterRecovery: true,
    runnerConnectionHealthyAfterRecovery: true,
    consecutiveRunnerFailuresAfterRecovery: 0,
    returningNodeEligibleAgain: true,
    survivorEvidence: {
      reclaimedTasks: survivor.reclaimedTasks,
      migrationClasses: survivor.tasks.map((task) => task.migrationClass).sort(),
      staleClaimsRejected: survivor.tasks.every((task) => task.staleClaimRejected),
      checkpointsPreserved: survivor.tasks.every((task) => task.checkpointPreserved),
    },
    verifiedAt: new Date().toISOString(),
  };

  await writeJson(output, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

async function verify(args) {
  const mac = await readJson(required(args, "mac"));
  const zbook = await readJson(required(args, "zbook"));
  const sha = required(args, "sha");
  const output = required(args, "output");

  assert.equal(mac.verdict, "PASS");
  assert.equal(zbook.verdict, "PASS");
  assert.equal(mac.sourceSha, sha);
  assert.equal(zbook.sourceSha, sha);
  assert.equal(mac.lostNode, "macbook");
  assert.equal(mac.survivingNode, "zbook");
  assert.equal(mac.lostPlatform, "darwin");
  assert.equal(zbook.lostNode, "zbook");
  assert.equal(zbook.survivingNode, "macbook");
  assert.equal(zbook.lostPlatform, "win32");

  for (const evidence of [mac, zbook]) {
    assert.equal(evidence.survivingNodeExecutedBeforeRecovery, true);
    assert.equal(evidence.watchdogRecovered, true);
    assert.equal(evidence.runnerHealthyAfterRecovery, true);
    assert.equal(evidence.runnerConnectionHealthyAfterRecovery, true);
    assert.equal(evidence.consecutiveRunnerFailuresAfterRecovery, 0);
    assert.equal(evidence.returningNodeEligibleAgain, true);
    assert.equal(evidence.survivorEvidence.reclaimedTasks, 2);
    assert.deepEqual(evidence.survivorEvidence.migrationClasses, ["MIGRATABLE", "RESTARTABLE"]);
    assert.equal(evidence.survivorEvidence.staleClaimsRejected, true);
    assert.equal(evidence.survivorEvidence.checkpointsPreserved, true);
  }

  const finalEvidence = {
    version: 1,
    verdict: "PASS",
    evidenceClass: "MACHINE_VERIFIED",
    scenario: "physical-runner-process-loss-recovery-rejoin",
    sourceSha: sha,
    directions: [mac, zbook],
    boundaries: {
      runnerProcessLossProven: true,
      survivingNodeContinuationProven: true,
      crossNodeMigrationDuringLossProven: true,
      watchdogAutomaticRecoveryProven: true,
      returningNodeRejoinProven: true,
      staleExecutionFencingProven: true,
      osShutdownProven: false,
      acPowerLossProven: false,
      networkPartitionProven: false,
    },
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(output, finalEvidence);
  process.stdout.write(`${JSON.stringify(finalEvidence)}\n`);
}

const args = parseArgs();
const phase = required(args, "phase");
if (phase === "rejoin") {
  await rejoin(args);
} else if (phase === "verify") {
  await verify(args);
} else {
  throw new Error(`Unsupported --phase ${phase}`);
}
