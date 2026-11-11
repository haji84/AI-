import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalDecisionStoreAdapter, CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { mergeDefinitionOfDoneResults } from "../src/orchestrator/work-state.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { GoalControllerExecutionBridge } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import { HostedGoalControllerAdapter, type HostedJobAuthority, type HostedJobBinding } from "../src/orchestrator/hosted-goal-controller-adapter.ts";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierReceipt } from "../src/orchestrator/signed-local-verifier-receipt.ts";
import type { FabricNode } from "../src/orchestrator/capability-fabric-router.ts";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const baseRevision = "a".repeat(40);
const scope = "issue:1219:hosted-ci-fixture";
const hostedNodes: FabricNode[] = [
  { id: "github-hosted-ci", kind: "cloud", capabilities: ["repository.inspect"], online: true,
    healthy: true, privacy: "public-ok", incrementalCost: 0, latencyMs: 100,
    reliability: 0.99, evidenceModes: ["ONLINE"] },
];
const expected = new Map([["hosted-a", "first verified artifact\n"], ["hosted-b", "second verified artifact\n"]]);
const bindings = (goalId: string): HostedJobBinding[] => [
  { goalId, jobId: "hosted-a", dependsOn: [], privacy: "public", evidenceMode: "ONLINE",
    allowedPaths: ["tests/fixtures/hosted-fixture-a.txt"] },
  { goalId, jobId: "hosted-b", dependsOn: ["hosted-a"], privacy: "public", evidenceMode: "ONLINE",
    allowedPaths: ["tests/fixtures/hosted-fixture-b.txt"] },
];

test("actual Goal Controller -> hosted Job A -> fixture-signed verification -> distinct Job B across durable adapter reconstruction", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-hosted-goal-"));
  const compassPath = join(root, "compass.sqlite");
  const jobsPath = join(root, "jobs.json");
  const changesPath = join(root, "changes.json");
  const keys = generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const receipts = new Map<string, SignedLocalVerifierReceipt>();
  const calls: string[] = [];
  const candidates = new Map<string, string>();
  let compass: CompassStore | null = null;
  try {
    compass = new CompassStore(compassPath);
    const registry = new CompassGoalRegistryAdapter(compass);
    const active = await registry.create({
      title: "Complete two bounded public artifacts", description: "GitHub hosted-only source fixture",
      successCriteria: ["Artifact A independently accepted", "Artifact B independently accepted"],
      constraints: ["No deployment or external writes", "Fixture signer is not a real separate principal"],
    });
    const goalId = active.goalId;
    await new CompassWorkStateStoreAdapter(compass).put({
      goalId, objective: active.goal.title,
      definitionOfDone: [
        { id: "hosted-a", description: "Artifact A verified", required: true },
        { id: "hosted-b", description: "Artifact B verified", required: true },
      ],
      currentState: "Authenticated hosted CI fixture accepted",
      status: "IN_PROGRESS", riskClass: "R0",
      constraints: [...active.goal.constraints],
      decisions: [], artifacts: [], verificationResults: [], childWorkItems: [],
      blockers: [], nextAction: "execute the next approved fixture Job",
      updatedAt: new Date().toISOString(),
    });
    const controller = new GoalControllerRuntime({
      registry, decisionStore: new CompassGoalDecisionStoreAdapter(compass),
    });
    const request = { source: "github" as const, text: "Complete two bounded public artifacts",
      goalHint: goalId, idempotencyKey: "ci:1219:two-jobs" };
    const decision = await controller.handle(request);
    assert.equal(decision.action, "CONTINUE_GOAL");
    assert.equal(decision.goalId, goalId);
    const jobs = new JsonFileDevelopmentJobStore(jobsPath);
    for (const b of bindings(goalId)) {
      await jobs.put(createDevelopmentJob({
        jobId: b.jobId, goalId, requirementIds: ["AUTO-010"], acceptanceCriteria: [b.jobId],
        definitionOfDone: [{ id: b.jobId, description: "exact bounded public fixture content", required: true }],
        baseRevision, approvalScope: { taskScopeId: scope, maxRisk: "low" },
        workItems: [{ id: b.jobId + ":work", objective: "write harmless deterministic test artifact",
          dependsOn: [], requiredCapabilities: ["repository.inspect"] }],
      }));
    }
    const authority: HostedJobAuthority = {
      async assertEligible({ jobId, nodeId }) {
        assert.equal(nodeId, "github-hosted-ci");
        assert.ok(jobId === "hosted-a" || jobId === "hosted-b");
        calls.push("start:" + jobId);
      },
      async currentGate() { return { paused: false, blockers: [] }; },
      async build({ job, allowedPaths }) {
        assert.equal(allowedPaths.length, 1);
        const expectedContent = expected.get(job.jobId)!;
        const candidateFile = join(root, "candidate", allowedPaths[0]!);
        mkdirSync(dirname(candidateFile), { recursive: true });
        writeFileSync(candidateFile, expectedContent, "utf8");
        const actual = readFileSync(candidateFile);
        const candidate = createDevelopmentChangeSet({
          changeSetId: job.jobId + ":candidate", jobId: job.jobId, workItemId: job.workItems[0]!.id,
          deviceId: "fixture-hosted-builder", baseRevision, changedPaths: allowedPaths,
          affectedSymbols: [], patchDigest: hash(actual), artifactDigest: hash(actual),
          evidenceDigest: hash("fixture evidence:" + job.jobId),
          rollback: { kind: "git-base", reference: baseRevision },
        });
        candidates.set(job.jobId, candidateFile);
        // This is a CI fixture: a second OS process hashes the actual file, but
        // the signer key is generated by this test. NOT a production trust claim.
        const independentlyRead = execFileSync(process.execPath, [
          "-e", "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex'))",
          candidateFile,
        ], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
        assert.equal(independentlyRead, candidate.artifactDigest);
        const plan = createDevelopmentVerificationPlan({
          builderId: candidate.deviceId, sourceRevision: candidate.candidateRevision,
          artifactDigest: candidate.artifactDigest, changedPaths: candidate.changedPaths,
        });
        const now = new Date().toISOString();
        // Six check records below are only fixture records; the real independent
        // six-check CI runs in a separate restricted container job.
        const payload = {
          version: 1 as const, verifierId: "fixture-signer-not-a-separate-principal",
          goalId, jobId: job.jobId, changeSetId: candidate.changeSetId,
          builderId: candidate.deviceId, baseRevision, sourceRevision: candidate.candidateRevision,
          artifactDigest: candidate.artifactDigest, issuedAt: now,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          checks: plan.requiredChecks.map(check => ({
            check, status: "passed" as const, outputDigest: hash("ci-fixture:" + check + ":" + independentlyRead),
            recordedAt: now,
          })),
        };
        const signatureBase64 = sign(null, Buffer.from(canonicalLocalVerifierPayload(payload)), keys.privateKey).toString("base64");
        receipts.set(job.jobId, { payload, signatureBase64 });
        return candidate;
      },
      async readVerifierReceipt(job) { return receipts.get(job.jobId) ?? null; },
      async verifyArtifactAcceptance({ job, candidate }) {
        const file = candidates.get(job.jobId);
        if (!file || hash(readFileSync(file)) !== candidate.artifactDigest ||
          readFileSync(file, "utf8") !== expected.get(job.jobId)) return false;
        const store = new CompassWorkStateStoreAdapter(compass!);
        const current = await store.get(job.goalId);
        assert.ok(current, "canonical Goal WorkState must exist");
        await store.put(mergeDefinitionOfDoneResults(current, [{
          itemId: job.jobId, passed: true, evidence: { kind: "CI_FIXTURE_SIGNER_NOT_PRODUCTION",
            sourceRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest },
        }], new Date().toISOString()));
        return true;
      },
    };
    const newAdapter = () => new HostedGoalControllerAdapter({
      goalId, baseRevision, taskScopeId: scope,
      builderId: "fixture-hosted-builder", verifierId: "fixture-signer-not-a-separate-principal",
      verifierPublicKeyPem: publicKeyPem, bindings: bindings(goalId), nodes: hostedNodes,
      jobs: new JsonFileDevelopmentJobStore(jobsPath),
      goalWorkState: new CompassWorkStateStoreAdapter(compass!),
      changes: new JsonFileDevelopmentChangeSetStore(changesPath), authority,
    });
    const first = await new GoalControllerExecutionBridge(newAdapter()).executeUntilGoalTerminal(decision, { maxRuns: 1 });
    assert.equal(first.executed, true);
    assert.equal(first.reason, "goal_continuation_budget_exhausted");
    assert.deepEqual(calls, ["start:hosted-a"]);
    const before = await jobs.getByGoal(goalId);
    assert.deepEqual(before.map(j => [j.jobId, j.phase]), [["hosted-a", "COMPLETED"], ["hosted-b", "QUEUED"]]);
    compass.close(); compass = null; // Drop the real owner-facing DB handle before reconstructing.
    compass = new CompassStore(compassPath);
    const restartedController = new GoalControllerRuntime({
      registry: new CompassGoalRegistryAdapter(compass),
      decisionStore: new CompassGoalDecisionStoreAdapter(compass),
    });
    const replay = await restartedController.handle(request);
    assert.equal(replay.goalId, goalId);
    assert.equal(compass.getGoal()?.title, "Complete two bounded public artifacts");
    const result = await new GoalControllerExecutionBridge(newAdapter()).executeUntilGoalTerminal(replay, { maxRuns: 3 });
    assert.equal(result.reason, "goal_complete");
    assert.equal(result.report?.goalEvaluation?.achieved, true);
    assert.deepEqual(calls, ["start:hosted-a", "start:hosted-b"]);
    const after = await new JsonFileDevelopmentJobStore(jobsPath).getByGoal(goalId);
    assert.equal(after.length, 2);
    assert.deepEqual(after.map(j => j.phase), ["COMPLETED", "COMPLETED"]);
    assert.notEqual(after[0]?.jobId, after[1]?.jobId);
    for (const job of after) {
      assert.equal(job.evidence[0]?.verified, true);
      assert.equal(job.evidence[0]?.kind, "signed-independent:v1");
      assert.equal(job.history.filter(h => h.to === "IMPLEMENTING").length, 1);
    }
    const duplicate = await new GoalControllerExecutionBridge(newAdapter()).executeUntilGoalTerminal(replay, { maxRuns: 2 });
    assert.equal(duplicate.reason, "goal_complete");
    assert.deepEqual(calls, ["start:hosted-a", "start:hosted-b"]);
    assert.equal((await new JsonFileDevelopmentJobStore(jobsPath).getByGoal(goalId)).length, 2);
  } finally {
    compass?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("hosted Goal adapter rejects a missing durable Job rather than creating work", async () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-hosted-empty-"));
  try {
    const adapter = new HostedGoalControllerAdapter({
      goalId: "goal-candidate", baseRevision, taskScopeId: scope,
      builderId: "test-builder", verifierId: "test-verifier", verifierPublicKeyPem: "fixture-pub",
      bindings: bindings("goal-candidate"), nodes: hostedNodes,
      jobs: new JsonFileDevelopmentJobStore(join(root, "jobs.json")),
      goalWorkState: { async get() { return null; }, async put() {}, async appendEvent() {} },
      changes: new JsonFileDevelopmentChangeSetStore(join(root, "changes.json")),
      authority: {
        async assertEligible() { assert.fail("cannot claim a missing persisted Job"); },
        async currentGate() { return { paused: false, blockers: [] }; },
        async build() { assert.fail("cannot build missing Job"); },
        async readVerifierReceipt() { return null; },
        async verifyArtifactAcceptance() { return false; },
      },
    });
    await assert.rejects(() => adapter.run("goal-candidate"), /HOSTED_GOAL_PERSISTED_JOB_SET_MISMATCH/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
