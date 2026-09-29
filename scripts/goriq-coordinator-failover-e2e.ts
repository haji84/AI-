import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DistributedCoordinatorRuntime,
  JsonFileCoordinatorStore,
  type CoordinatorCandidate,
  type CoordinatorClaim,
} from "../src/gai/distributed-coordinator.ts";

type NodeId = "macbook" | "zbook";

interface Metadata {
  version: 1;
  sourceSha: string;
  clusterId: string;
  preparedBy: NodeId;
  leaseMs: number;
  initialClaim: CoordinatorClaim;
}

interface FailoverEvidence {
  version: 1;
  sourceSha: string;
  clusterId: string;
  phase: "zbook-failover";
  executedOn: NodeId;
  platform: string;
  runnerName: string | null;
  oldCoordinator: NodeId;
  newCoordinator: NodeId;
  oldEpoch: number;
  newEpoch: number;
  staleOldClaimRejected: boolean;
  verifiedAt: string;
}

interface ReturnEvidence {
  version: 1;
  sourceSha: string;
  clusterId: string;
  phase: "macbook-return-rebalance";
  executedOn: NodeId;
  platform: string;
  runnerName: string | null;
  activeCoordinatorOnReturn: NodeId;
  epochOnReturn: number;
  prematurePreemptionPrevented: boolean;
  leaseBoundaryMode: "controlled-future-time";
  coordinatorAfterLeaseBoundary: NodeId;
  epochAfterLeaseBoundary: number;
  staleZbookClaimRejected: boolean;
  verifiedAt: string;
}

function parseArgs(): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (!key?.startsWith("--")) continue;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) {
      out.set(key.slice(2), "true");
      continue;
    }
    out.set(key.slice(2), value);
    i += 1;
  }
  return out;
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function nodeId(value: string): NodeId {
  if (value !== "macbook" && value !== "zbook") throw new Error(`Invalid node: ${value}`);
  return value;
}

function candidate(
  node: NodeId,
  score: number,
  available = true,
  eligible = true,
): CoordinatorCandidate {
  return {
    nodeId: node,
    score,
    available,
    eligible,
    observedAt: new Date().toISOString(),
  };
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepare(args: Map<string, string>): Promise<void> {
  const dir = resolve(required(args, "dir"));
  const sourceSha = required(args, "sha");
  const clusterId = required(args, "cluster");
  const leaseMs = Number(args.get("lease-ms") ?? "5000");
  assert.ok(Number.isFinite(leaseMs) && leaseMs >= 2000 && leaseMs <= 30000);

  await mkdir(dir, { recursive: true });
  const runtime = new DistributedCoordinatorRuntime(
    new JsonFileCoordinatorStore(resolve(dir, "coordinator.json")),
    clusterId,
  );
  const claim = await runtime.elect(
    [
      candidate("macbook", 100, true),
      candidate("zbook", 50, true),
    ],
    leaseMs,
    new Date(),
  );
  assert.equal(claim.coordinatorId, "macbook");
  assert.equal(claim.epoch, 1);
  await runtime.assertAuthoritative(claim, new Date());

  const metadata: Metadata = {
    version: 1,
    sourceSha,
    clusterId,
    preparedBy: "macbook",
    leaseMs,
    initialClaim: claim,
  };
  await writeJson(resolve(dir, "metadata.json"), metadata);
  process.stdout.write(`${JSON.stringify({
    phase: "prepare",
    sourceSha,
    clusterId,
    coordinatorId: claim.coordinatorId,
    epoch: claim.epoch,
  })}\n`);
}

async function zbookFailover(args: Map<string, string>): Promise<void> {
  const dir = resolve(required(args, "dir"));
  const evidencePath = resolve(required(args, "evidence"));
  const sourceSha = required(args, "sha");
  const node = nodeId(required(args, "node"));
  assert.equal(node, "zbook");

  const metadata = await json<Metadata>(resolve(dir, "metadata.json"));
  assert.equal(metadata.sourceSha, sourceSha);
  const runtime = new DistributedCoordinatorRuntime(
    new JsonFileCoordinatorStore(resolve(dir, "coordinator.json")),
    metadata.clusterId,
  );

  const failoverLeaseMs = Math.max(metadata.leaseMs, 3_600_000);
  const claim = await runtime.elect(
    [
      candidate("macbook", 100, false),
      candidate("zbook", 50, true),
    ],
    failoverLeaseMs,
    new Date(),
  );
  assert.equal(claim.coordinatorId, "zbook");
  assert.equal(claim.epoch, metadata.initialClaim.epoch + 1);

  let staleOldClaimRejected = false;
  try {
    await runtime.assertAuthoritative(metadata.initialClaim, new Date());
  } catch (error) {
    staleOldClaimRejected = /STALE_COORDINATOR_CLAIM/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  assert.equal(staleOldClaimRejected, true);
  await runtime.assertAuthoritative(claim, new Date());

  await writeJson(resolve(dir, "zbook-claim.json"), claim);
  const evidence: FailoverEvidence = {
    version: 1,
    sourceSha,
    clusterId: metadata.clusterId,
    phase: "zbook-failover",
    executedOn: node,
    platform: process.platform,
    runnerName: process.env.RUNNER_NAME ?? null,
    oldCoordinator: "macbook",
    newCoordinator: "zbook",
    oldEpoch: metadata.initialClaim.epoch,
    newEpoch: claim.epoch,
    staleOldClaimRejected,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

async function macReturn(args: Map<string, string>): Promise<void> {
  const dir = resolve(required(args, "dir"));
  const evidencePath = resolve(required(args, "evidence"));
  const sourceSha = required(args, "sha");
  const node = nodeId(required(args, "node"));
  assert.equal(node, "macbook");

  const metadata = await json<Metadata>(resolve(dir, "metadata.json"));
  const zbookClaim = await json<CoordinatorClaim>(resolve(dir, "zbook-claim.json"));
  assert.equal(metadata.sourceSha, sourceSha);
  assert.equal(zbookClaim.coordinatorId, "zbook");

  const runtime = new DistributedCoordinatorRuntime(
    new JsonFileCoordinatorStore(resolve(dir, "coordinator.json")),
    metadata.clusterId,
  );

  const retained = await runtime.elect(
    [
      candidate("macbook", 200, true),
      candidate("zbook", 50, true),
    ],
    metadata.leaseMs,
    new Date(),
  );
  assert.equal(retained.coordinatorId, "zbook");
  assert.equal(retained.epoch, zbookClaim.epoch);
  assert.equal(retained.fencingToken, zbookClaim.fencingToken);
  const prematurePreemptionPrevented = true;

  const leaseBoundary = new Date(Date.parse(retained.leaseUntil) + 1);
  const rebalanced = await runtime.elect(
    [
      candidate("macbook", 200, true),
      candidate("zbook", 50, true),
    ],
    metadata.leaseMs,
    leaseBoundary,
  );
  assert.equal(rebalanced.coordinatorId, "macbook");
  assert.equal(rebalanced.epoch, retained.epoch + 1);
  assert.notEqual(rebalanced.fencingToken, retained.fencingToken);

  let staleZbookClaimRejected = false;
  try {
    await runtime.assertAuthoritative(retained, leaseBoundary);
  } catch (error) {
    staleZbookClaimRejected = /STALE_COORDINATOR_CLAIM/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  assert.equal(staleZbookClaimRejected, true);
  await runtime.assertAuthoritative(rebalanced, new Date());

  const evidence: ReturnEvidence = {
    version: 1,
    sourceSha,
    clusterId: metadata.clusterId,
    phase: "macbook-return-rebalance",
    executedOn: node,
    platform: process.platform,
    runnerName: process.env.RUNNER_NAME ?? null,
    activeCoordinatorOnReturn: "zbook",
    epochOnReturn: retained.epoch,
    prematurePreemptionPrevented,
    leaseBoundaryMode: "controlled-future-time",
    coordinatorAfterLeaseBoundary: "macbook",
    epochAfterLeaseBoundary: rebalanced.epoch,
    staleZbookClaimRejected,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

async function verify(args: Map<string, string>): Promise<void> {
  const failover = await json<FailoverEvidence>(resolve(required(args, "failover")));
  const returned = await json<ReturnEvidence>(resolve(required(args, "return")));
  const sourceSha = required(args, "sha");
  const output = resolve(required(args, "output"));

  assert.equal(failover.sourceSha, sourceSha);
  assert.equal(returned.sourceSha, sourceSha);
  assert.equal(failover.clusterId, returned.clusterId);
  assert.equal(failover.platform, "win32");
  assert.equal(returned.platform, "darwin");
  assert.equal(failover.newCoordinator, "zbook");
  assert.equal(failover.newEpoch, failover.oldEpoch + 1);
  assert.equal(failover.staleOldClaimRejected, true);
  assert.equal(returned.activeCoordinatorOnReturn, "zbook");
  assert.equal(returned.epochOnReturn, failover.newEpoch);
  assert.equal(returned.prematurePreemptionPrevented, true);
  assert.equal(returned.coordinatorAfterLeaseBoundary, "macbook");
  assert.equal(returned.epochAfterLeaseBoundary, failover.newEpoch + 1);
  assert.equal(returned.staleZbookClaimRejected, true);

  const finalEvidence = {
    version: 1,
    verdict: "PASS",
    evidenceClass: "MACHINE_VERIFIED",
    scenario: "controlled-coordinator-loss-return-rebalance",
    sourceSha,
    clusterId: failover.clusterId,
    sequence: [
      {
        coordinator: "macbook",
        epoch: failover.oldEpoch,
      },
      {
        coordinator: "zbook",
        epoch: failover.newEpoch,
        staleMacClaimRejected: failover.staleOldClaimRejected,
      },
      {
        coordinator: "zbook",
        epoch: returned.epochOnReturn,
        returningMacDidNotPreempt: returned.prematurePreemptionPrevented,
      },
      {
        coordinator: "macbook",
        epoch: returned.epochAfterLeaseBoundary,
        staleZbookClaimRejected: returned.staleZbookClaimRejected,
      },
    ],
    physical: {
      zbookRunnerName: failover.runnerName,
      zbookPlatform: failover.platform,
      macbookRunnerName: returned.runnerName,
      macbookPlatform: returned.platform,
    },
    boundaries: {
      controlledCoordinatorLossProven: true,
      staleCoordinatorFencingProven: true,
      returnWithoutPrematurePreemptionProven: true,
      postLeaseRebalanceProven: true,
      controlledLeaseBoundaryProven: true,
      realTimeLeaseExpiryProven: false,
      abruptPowerLossProven: false,
      networkPartitionProven: false,
      productionCoordinatorWiringProven: false,
    },
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(output, finalEvidence);
  process.stdout.write(`${JSON.stringify(finalEvidence)}\n`);
}

const args = parseArgs();
const phase = required(args, "phase");
if (phase === "prepare") {
  await prepare(args);
} else if (phase === "zbook-failover") {
  await zbookFailover(args);
} else if (phase === "mac-return") {
  await macReturn(args);
} else if (phase === "verify") {
  await verify(args);
} else {
  throw new Error(`Unsupported phase: ${phase}`);
}
