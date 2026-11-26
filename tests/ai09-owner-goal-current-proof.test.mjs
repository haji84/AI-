import test from "node:test";
import assert from "node:assert/strict";
import { probeLiveGoriqConnection } from "../scripts/goriq-ai09-live-broker-builder-probe.mjs";

const ownerToken = "fixture-only-owner-credential";
const goalId = "goal-fcc81c97e09153f7";
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

function host(proof) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options) {
      calls.push({ url, method: options.method, redirect: options.redirect });
      if (url === "http://127.0.0.1:8787/health") return response({ ok: true, service: "jarvis-broker" });
      if (url === "http://127.0.0.1:8787/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe")
        return response({ events: [] });
      if (url === "http://127.0.0.1:8787/api/jarvis/admin/work/" + goalId)
        return response({ run: { goalId, phase: "HUMAN_GATE" }, ...proof });
      throw Error("unexpected host request");
    },
  };
}

test("owner Goal probe refuses a legacy run that lacks current Compass authority", async () => {
  const local = host({});
  const checked = await probeLiveGoriqConnection({
    mode: "broker", ownerToken, goalId, fetchImpl: local.fetchImpl,
  });
  assert.equal(checked.status, "HOLD");
  assert.equal(checked.reason, "GOAL_AUTHORITY_NOT_VERIFIED");
  assert.equal(checked.brokerAuthenticated, true);
  assert.equal(checked.goalWorkRunObserved, false);
  assert.equal(checked.writeAuthorized, false);
  assert.equal(checked.builderAcknowledged, false);
  assert.equal(local.calls.length, 3);
});

test("owner Goal probe rejects historical and mismatched authority even for a matching WorkRun", async () => {
  const invalid = [
    { kind: "HISTORICAL_WORK_RUN", goalId, current: false },
    { kind: "CURRENT_COMPASS_GOAL", goalId: "goal-foreign", current: true },
    { kind: "CURRENT_COMPASS_GOAL", goalId, current: false },
    { kind: "CURRENT_COMPASS_GOAL", goalId, current: "true" },
  ];
  for (const goalAuthority of invalid) {
    const local = host({ goalAuthority });
    const checked = await probeLiveGoriqConnection({
      mode: "broker", ownerToken, goalId, fetchImpl: local.fetchImpl,
    });
    assert.equal(checked.status, "HOLD");
    assert.equal(checked.reason, "GOAL_AUTHORITY_NOT_VERIFIED");
    assert.equal(checked.goalWorkRunObserved, false);
    assert.equal(checked.builderAcknowledged, false);
  }
});

test("current Compass Goal readback is status-only, including an existing Human Gate", async () => {
  const local = host({ goalAuthority: { kind: "CURRENT_COMPASS_GOAL", goalId, current: true } });
  const checked = await probeLiveGoriqConnection({
    mode: "broker", ownerToken, goalId, fetchImpl: local.fetchImpl,
  });
  assert.equal(checked.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(checked.goalWorkRunObserved, true);
  assert.equal(checked.goalWorkRunPhase, "HUMAN_GATE");
  assert.equal(checked.completionClaim, false);
  assert.equal(checked.writeAuthorized, false);
  assert.equal(checked.mergeAuthorized, false);
  assert.equal(checked.builderAcknowledged, false);
  assert.ok(local.calls.every(call => call.method === "GET" && call.redirect === "error"));
});

const expectedJob = "fixture-rotation-recovery";
const scopedJob = {
  kind: "LOCAL_PERSISTED_JOBS",
  goalId,
  goalDigest: "b".repeat(64),
  remoteAuthorityVerified: false,
  jobs: [{
    jobId: expectedJob, phase: "VERIFYING", recordSha256: "c".repeat(64),
    approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
  }],
};
const currentGoal = { kind: "CURRENT_COMPASS_GOAL", goalId, current: true };

test("existing owner probe binds exact stored Job and scope without claiming execution", async () => {
  const fixture = host({ goalAuthority: currentGoal, jobReadback: scopedJob });
  const checked = await probeLiveGoriqConnection({
    mode: "broker", ownerToken, goalId, jobId: expectedJob, fetchImpl: fixture.fetchImpl,
  });
  assert.equal(checked.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(checked.goalWorkRunObserved, true);
  assert.equal(checked.jobReadbackObserved, true);
  assert.equal(checked.jobReadbackPhase, "VERIFYING");
  assert.equal(checked.jobRecordSha256, "c".repeat(64));
  assert.equal(checked.writeAuthorized, false);
  assert.equal(checked.mergeAuthorized, false);
  assert.equal(checked.builderAcknowledged, false);
  assert.ok(fixture.calls.every(row => row.method === "GET"));
});

test("owner probe refuses a missing, foreign or unscoped Job even with an authenticated Goal", async () => {
  const invalid = [
    undefined,
    { ...scopedJob, kind: "HISTORICAL_ONLY" },
    { ...scopedJob, goalId: "goal-someone-else" },
    { ...scopedJob, jobs: [] },
    { ...scopedJob, jobs: [{ ...scopedJob.jobs[0], jobId: "fixture-foreign" }] },
    { ...scopedJob, jobs: [{ ...scopedJob.jobs[0], recordSha256: "not-a-sha" }] },
    { ...scopedJob, jobs: [{ ...scopedJob.jobs[0], approvalScope: { taskScopeId: "", maxRisk: "low" } }] },
  ];
  for (const jobReadback of invalid) {
    const fixture = host({ goalAuthority: currentGoal, jobReadback });
    const checked = await probeLiveGoriqConnection({
      mode: "broker", ownerToken, goalId, jobId: expectedJob, fetchImpl: fixture.fetchImpl,
    });
    assert.equal(checked.status, "HOLD");
    assert.equal(checked.reason, "JOB_READBACK_NOT_AUTHENTICATED");
    assert.equal(checked.jobReadbackObserved, false);
    assert.equal(checked.builderAcknowledged, false);
  }
});

test("owner probe cannot request a Job without a well-formed bound Goal and never contacts host", async () => {
  const fixture = host({ goalAuthority: currentGoal, jobReadback: scopedJob });
  for (const input of [
    { mode: "broker", ownerToken, jobId: expectedJob },
    { mode: "builder", builderToken: "fixture-builder-token", goalId, jobId: expectedJob },
    { mode: "broker", ownerToken, goalId, jobId: "../etc/passwd" },
  ]) {
    const checked = await probeLiveGoriqConnection({ ...input, fetchImpl: fixture.fetchImpl });
    assert.equal(checked.status, "HOLD");
    assert.equal(checked.reason, "INVALID_JOB_IDENTIFIER");
  }
  assert.equal(fixture.calls.length, 0);
});
