import test from "node:test";
import assert from "node:assert/strict";
import { classifyMutation, createBaseline, planRollback, restorationComplete, verifyBaseline, type ChangeSet } from "../src/jarvis/config-baseline-rollback.ts";

const baseline = () => createBaseline({
  id: "base-1", goalId: "goal-1008", issue: 1008,
  capturedAt: "2026-09-21T12:30:00Z", sourceRevision: "abc123",
  surfaces: [
    { kind: "repository", id: "repo", state: { revision: "abc123" } },
    { kind: "workflow_gate_risk", id: "gate", state: { policy: "human-gate-preserved" } },
    { kind: "secret_metadata", id: "secrets", state: { name: "DEPLOY_TOKEN", scope: "repo", fingerprint: "sha256:x" } },
  ],
});

const change = (overrides: Partial<ChangeSet> = {}): ChangeSet => ({
  id: "cs-1", baselineId: "base-1", goalId: "goal-1008", issue: 1008,
  actor: "jarvis", reason: "test", timestamp: "2026-09-21T12:31:00Z",
  targets: ["repo"], dependencies: [], beforeRefs: ["abc123"], afterRefs: ["def456"],
  verificationEvidence: ["unit"], rollbackProcedure: ["restore repo"], reversibility: "REVERSIBLE",
  ...overrides,
});

test("baseline is tamper evident and allows secret metadata only", () => {
  const b = baseline();
  assert.equal(verifyBaseline(b), true);
  assert.equal(verifyBaseline({ ...b, sourceRevision: "tampered" }), false);
  assert.throws(() => createBaseline({
    id:"x", goalId:"g", capturedAt:"x", sourceRevision:"x",
    surfaces:[{ kind:"secret_metadata", id:"s", state:{ token:"plaintext-secret" } }],
  }), /SECRET_VALUE_REJECTED/);
});

test("reversible change can restore only with fresh evidence and full verification", () => {
  const b = baseline();
  const d = planRollback({ baseline:b, changeSets:[change()], evidenceRevision:"abc123" });
  assert.equal(d.status, "READY");
  assert.equal(restorationComplete({ decision:d, evidence:{ ci:true, verifier:true, security:true, runtime:true, goal_progress:true } }), true);
  assert.equal(restorationComplete({ decision:d, evidence:{ ci:true, verifier:true } }), false);
  assert.deepEqual(planRollback({ baseline:b, changeSets:[change()], evidenceRevision:"old" }), { status:"BLOCKED", reason:"STALE_BASELINE_EVIDENCE" });
});

test("irreversible and privileged mutations require Human Gate", () => {
  assert.equal(classifyMutation({ databaseMigration:true }), "IRREVERSIBLE");
  assert.equal(classifyMutation({ databaseMigration:true, compensatingAction:true }), "HARD_TO_REVERSE");
  assert.equal(classifyMutation({ permissionChange:true }), "HARD_TO_REVERSE");
  const d = planRollback({ baseline:baseline(), changeSets:[change({ reversibility:"IRREVERSIBLE" })], evidenceRevision:"abc123" });
  assert.deepEqual(d, { status:"HUMAN_REQUIRED", reason:"NON_REVERSIBLE_OR_PRIVILEGED_CHANGE" });
});

test("dependency-inconsistent partial rollback fails closed", () => {
  const changes = [
    change({ id:"config", targets:["config"], dependencies:["workflow"] }),
    change({ id:"workflow", targets:["workflow"], dependencies:[] }),
  ];
  assert.deepEqual(
    planRollback({ baseline:baseline(), changeSets:changes, targetIds:["config"], evidenceRevision:"abc123" }),
    { status:"BLOCKED", reason:"DEPENDENCY_INCONSISTENT:workflow" },
  );
  assert.equal(planRollback({ baseline:baseline(), changeSets:changes, targetIds:["config","workflow"], evidenceRevision:"abc123" }).status, "READY");
});
