import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DurableTaskRuntime,
  JsonFileDurableTaskStore,
  type DurableTaskExecutionClaim,
  type DurableTaskMigrationClass,
} from "../src/gai/durable-task-runtime.ts";

type NodeId = "macbook" | "zbook";

interface HandoffTask {
  id: string;
  migrationClass: DurableTaskMigrationClass;
  checkpointRef?: string;
}

interface HandoffMetadata {
  version: 1;
  direction: string;
  origin: NodeId;
  target: NodeId;
  sourceSha: string;
  preparedAt: string;
  leaseMs: number;
  tasks: HandoffTask[];
}

interface ClaimEnvelope {
  claims: Record<string, DurableTaskExecutionClaim>;
}

interface TaskEvidence {
  id: string;
  migrationClass: DurableTaskMigrationClass;
  oldEpoch: number;
  newEpoch: number;
  staleClaimRejected: boolean;
  checkpointPreserved: boolean;
  completedBy: NodeId;
}

interface FailoverEvidence {
  version: 1;
  verdict: "PASS";
  sourceSha: string;
  direction: string;
  origin: NodeId;
  target: NodeId;
  targetPlatform: string;
  targetRunnerName: string | null;
  reclaimedTasks: number;
  tasks: TaskEvidence[];
  verifiedAt: string;
}

function args(): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key?.startsWith("--")) continue;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) {
      parsed.set(key.slice(2), "true");
      continue;
    }
    parsed.set(key.slice(2), value);
    i += 1;
  }
  return parsed;
}

function required(input: Map<string, string>, key: string): string {
  const value = input.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function nodeId(value: string): NodeId {
  if (value !== "macbook" && value !== "zbook") throw new Error(`Invalid node id: ${value}`);
  return value;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function prepare(input: Map<string, string>): Promise<void> {
  const dir = resolve(required(input, "dir"));
  const origin = nodeId(required(input, "origin"));
  const target = nodeId(required(input, "target"));
  assert.notEqual(origin, target, "origin and target must differ");
  const sourceSha = required(input, "sha");
  const leaseMs = Number(input.get("lease-ms") ?? "3000");
  assert.ok(Number.isFinite(leaseMs) && leaseMs > 0 && leaseMs <= 30_000, "lease-ms must be within 1..30000");

  await mkdir(dir, { recursive: true });
  const taskStorePath = resolve(dir, "tasks.json");
  const runtime = new DurableTaskRuntime(new JsonFileDurableTaskStore(taskStorePath));
  const direction = `${origin}-to-${target}`;
  const now = new Date();

  const tasks: HandoffTask[] = [
    {
      id: `stage-b-${direction}-migratable`,
      migrationClass: "MIGRATABLE",
      checkpointRef: `checkpoint://stage-b/${direction}/1`,
    },
    {
      id: `stage-b-${direction}-restartable`,
      migrationClass: "RESTARTABLE",
    },
  ];

  const claims: Record<string, DurableTaskExecutionClaim> = {};
  for (const [index, spec] of tasks.entries()) {
    const offset = index * 20;
    await runtime.enqueue({
      id: spec.id,
      idempotencyKey: spec.id,
      type: `stage-b-${spec.migrationClass.toLowerCase()}`,
      migrationClass: spec.migrationClass,
      maxAttempts: 3,
    }, new Date(now.getTime() + offset));
    const claim = await runtime.leaseClaim(
      spec.id,
      origin,
      leaseMs,
      new Date(now.getTime() + offset + 1),
    );
    await runtime.markRunningClaimed(claim, new Date(now.getTime() + offset + 2));
    if (spec.checkpointRef) {
      await runtime.setCheckpointRefClaimed(
        claim,
        spec.checkpointRef,
        new Date(now.getTime() + offset + 3),
      );
    }
    claims[spec.id] = claim;
  }

  const metadata: HandoffMetadata = {
    version: 1,
    direction,
    origin,
    target,
    sourceSha,
    preparedAt: new Date().toISOString(),
    leaseMs,
    tasks,
  };
  await writeJson(resolve(dir, "handoff.json"), metadata);
  await writeJson(resolve(dir, "claims.json"), { claims } satisfies ClaimEnvelope);

  process.stdout.write(`${JSON.stringify({
    phase: "prepared",
    direction,
    origin,
    target,
    sourceSha,
    taskCount: tasks.length,
    leaseMs,
  })}\n`);
}

async function waitForLeaseExpiry(claims: DurableTaskExecutionClaim[]): Promise<void> {
  const latest = Math.max(...claims.map((claim) => new Date(claim.leaseUntil).getTime()));
  const remaining = latest + 250 - Date.now();
  if (remaining > 30_000) throw new Error(`Lease expiry is unexpectedly far away: ${remaining}ms`);
  if (remaining > 0) await delay(remaining);
}

async function resume(input: Map<string, string>): Promise<void> {
  const dir = resolve(required(input, "dir"));
  const evidencePath = resolve(required(input, "evidence"));
  const node = nodeId(required(input, "node"));
  const expectedSha = required(input, "sha");

  const metadata = await readJson<HandoffMetadata>(resolve(dir, "handoff.json"));
  const envelope = await readJson<ClaimEnvelope>(resolve(dir, "claims.json"));
  assert.equal(metadata.version, 1);
  assert.equal(metadata.target, node, "handoff target does not match this node");
  assert.equal(metadata.sourceSha, expectedSha, "handoff source SHA does not match workflow SHA");
  assert.equal(Object.keys(envelope.claims).length, metadata.tasks.length);

  const originalClaims = metadata.tasks.map((task) => {
    const claim = envelope.claims[task.id];
    assert.ok(claim, `missing original claim for ${task.id}`);
    assert.equal(claim.owner, metadata.origin);
    return claim;
  });
  await waitForLeaseExpiry(originalClaims);

  const runtime = new DurableTaskRuntime(new JsonFileDurableTaskStore(resolve(dir, "tasks.json")));
  await runtime.initialize();
  const reclaimed = await runtime.reclaimExpiredLeases(new Date());
  assert.equal(reclaimed, metadata.tasks.length, "all origin-node leases must be reclaimed");

  const taskEvidence: TaskEvidence[] = [];
  for (const spec of metadata.tasks) {
    const oldClaim = envelope.claims[spec.id]!;
    const recovered = await runtime.get(spec.id);
    assert.ok(recovered, `missing recovered task ${spec.id}`);
    assert.equal(recovered.status, "retrying");
    assert.equal(recovered.migrationClass, spec.migrationClass);
    if (spec.migrationClass === "MIGRATABLE") {
      assert.equal(recovered.checkpointRef, spec.checkpointRef);
    } else {
      assert.equal(recovered.checkpointRef, undefined);
    }

    const newClaim = await runtime.leaseClaim(spec.id, node, 15_000, new Date());
    assert.equal(newClaim.epoch, oldClaim.epoch + 1);
    assert.notEqual(newClaim.fencingToken, oldClaim.fencingToken);

    let staleClaimRejected = false;
    try {
      await runtime.completeClaimed(oldClaim, { stale: true, mustNotCommit: true }, new Date());
    } catch (error) {
      staleClaimRejected = /STALE_EXECUTION_CLAIM/.test(error instanceof Error ? error.message : String(error));
    }
    assert.equal(staleClaimRejected, true, `stale claim for ${spec.id} was not fenced`);

    await runtime.markRunningClaimed(newClaim, new Date());
    const completed = await runtime.completeClaimed(
      newClaim,
      {
        executedBy: node,
        physicalPlatform: process.platform,
        migrationClass: spec.migrationClass,
      },
      new Date(),
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.executionEpoch, newClaim.epoch);
    assert.deepEqual(completed.result, {
      executedBy: node,
      physicalPlatform: process.platform,
      migrationClass: spec.migrationClass,
    });

    taskEvidence.push({
      id: spec.id,
      migrationClass: spec.migrationClass,
      oldEpoch: oldClaim.epoch,
      newEpoch: newClaim.epoch,
      staleClaimRejected,
      checkpointPreserved: spec.migrationClass === "MIGRATABLE"
        ? completed.checkpointRef === spec.checkpointRef
        : completed.checkpointRef === undefined,
      completedBy: node,
    });
  }

  const evidence: FailoverEvidence = {
    version: 1,
    verdict: "PASS",
    sourceSha: metadata.sourceSha,
    direction: metadata.direction,
    origin: metadata.origin,
    target: metadata.target,
    targetPlatform: process.platform,
    targetRunnerName: process.env.RUNNER_NAME ?? null,
    reclaimedTasks: reclaimed,
    tasks: taskEvidence,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

async function verify(input: Map<string, string>): Promise<void> {
  const first = await readJson<FailoverEvidence>(resolve(required(input, "evidence-a")));
  const second = await readJson<FailoverEvidence>(resolve(required(input, "evidence-b")));
  const output = resolve(required(input, "output"));
  const expectedSha = required(input, "sha");

  const pair = [first, second];
  assert.deepEqual(
    new Set(pair.map((item) => item.direction)),
    new Set(["macbook-to-zbook", "zbook-to-macbook"]),
  );
  for (const evidence of pair) {
    assert.equal(evidence.verdict, "PASS");
    assert.equal(evidence.sourceSha, expectedSha);
    assert.equal(evidence.reclaimedTasks, 2);
    assert.equal(evidence.tasks.length, 2);
    assert.ok(evidence.tasks.every((task) => task.newEpoch === task.oldEpoch + 1));
    assert.ok(evidence.tasks.every((task) => task.staleClaimRejected));
    assert.ok(evidence.tasks.every((task) => task.checkpointPreserved));
  }

  const macTarget = pair.find((item) => item.target === "macbook");
  const zbookTarget = pair.find((item) => item.target === "zbook");
  assert.equal(macTarget?.targetPlatform, "darwin");
  assert.equal(zbookTarget?.targetPlatform, "win32");

  const combined = {
    version: 1,
    verdict: "PASS",
    evidenceClass: "MACHINE_VERIFIED",
    scenario: "controlled-lease-loss-two-node-failover",
    sourceSha: expectedSha,
    directions: pair.map((item) => ({
      direction: item.direction,
      origin: item.origin,
      target: item.target,
      targetPlatform: item.targetPlatform,
      targetRunnerName: item.targetRunnerName,
      reclaimedTasks: item.reclaimedTasks,
      tasks: item.tasks,
    })),
    boundaries: {
      abruptPowerLossProven: false,
      networkPartitionProven: false,
      coordinatorLossProven: false,
      physicalNodesExecuted: true,
      migrationAndRestartAcrossPhysicalNodesProven: true,
      staleClaimFencingProven: true,
    },
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(output, combined);
  process.stdout.write(`${JSON.stringify(combined)}\n`);
}

const input = args();
const phase = required(input, "phase");
if (phase === "prepare") {
  await prepare(input);
} else if (phase === "resume") {
  await resume(input);
} else if (phase === "verify") {
  await verify(input);
} else {
  throw new Error(`Unsupported --phase ${phase}`);
}
