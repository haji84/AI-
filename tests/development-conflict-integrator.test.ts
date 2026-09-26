import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { DevelopmentConflictIntegrator } from "../src/orchestrator/development-conflict-integrator.ts";

function change(id: string, deviceId: string, path: string, patch: string) {
  return createDevelopmentChangeSet({
    changeSetId: id,
    jobId: "job-681",
    workItemId: "work-1",
    deviceId,
    baseRevision: "a".repeat(40),
    changedPaths: [path],
    affectedSymbols: ["run"],
    patchDigest: patch.repeat(64),
    evidenceDigest: "e".repeat(64),
    rollback: { kind: "git-base", reference: "a".repeat(40) },
  });
}

test("independent development changes integrate deterministically", async () => {
  const result = await new DevelopmentConflictIntegrator().integrate({
    local: change("local", "zbook", "src/a.ts", "b"),
    remote: change("remote", "macbook", "src/b.ts", "c"),
    acceptanceCriteria: ["criterion-a", "criterion-b"],
    verify: async () => ({ ok: true, evidenceDigest: "f".repeat(64) }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changeSet?.changedPaths, ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(result.provenance?.sourceChangeSetIds, ["local", "remote"]);
});

test("semantic candidates are rejected until all criteria and verifier pass", async () => {
  const attempted: string[] = [];
  const result = await new DevelopmentConflictIntegrator({
    async candidates() {
      return [
        { id: "drops-criterion", changedPaths: ["src/same.ts"], patchDigest: "1".repeat(64), satisfiedCriteria: ["criterion-a"] },
        { id: "fails-tests", changedPaths: ["src/same.ts"], patchDigest: "2".repeat(64), satisfiedCriteria: ["criterion-a", "criterion-b"] },
        { id: "passes", changedPaths: ["src/same.ts"], patchDigest: "3".repeat(64), satisfiedCriteria: ["criterion-a", "criterion-b"] },
      ];
    },
  }).integrate({
    local: change("local", "zbook", "src/same.ts", "b"),
    remote: change("remote", "macbook", "src/same.ts", "c"),
    acceptanceCriteria: ["criterion-a", "criterion-b"],
    async verify(candidate) {
      attempted.push(candidate.id);
      return { ok: candidate.id === "passes", evidenceDigest: candidate.id === "passes" ? "f".repeat(64) : "0".repeat(64), failureSignature: `failure:${candidate.id}` };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.selectedCandidateId, "passes");
  assert.deepEqual(attempted, ["fails-tests", "passes"]);
  assert.deepEqual(result.rejectedCandidates, ["drops-criterion:missing_acceptance", "fails-tests:failure:fails-tests"]);
  assert.equal(result.changeSet?.evidenceDigest, "f".repeat(64));
});

test("no verified integration candidate preserves both source changes", async () => {
  const local = change("local", "zbook", "src/same.ts", "b");
  const remote = change("remote", "macbook", "src/same.ts", "c");
  const result = await new DevelopmentConflictIntegrator({ async candidates() { return []; } }).integrate({
    local,
    remote,
    acceptanceCriteria: ["criterion"],
    verify: async () => ({ ok: false, evidenceDigest: "0".repeat(64) }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "no_verified_integration_candidate");
  assert.deepEqual(result.preserved, [local, remote]);
});

