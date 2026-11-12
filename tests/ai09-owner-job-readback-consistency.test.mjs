import test from "node:test";
import assert from "node:assert/strict";
import { probeLiveGoriqConnection } from "../scripts/goriq-ai09-live-broker-builder-probe.mjs";

const goalId = "goal-fixture-readback";
const jobId = "job-fixture-readback";
const ownerToken = "fixture-only-owner-token";
const clone = value => JSON.parse(JSON.stringify(value));
const response = body => ({ ok: true, text: async () => JSON.stringify(body) });
const initial = () => ({
  run: { goalId, phase: "RUNNING" },
  goalAuthority: { kind: "CURRENT_COMPASS_GOAL", goalId, current: true },
  jobReadback: {
    kind: "LOCAL_PERSISTED_JOBS", goalId, goalDigest: "a".repeat(64),
    remoteAuthorityVerified: false,
    jobs: [{ jobId, phase: "VERIFYING", recordSha256: "b".repeat(64),
      approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" } }],
  },
});
function host(first, second = first) {
  const requests = [];
  let reads = 0;
  return {
    requests,
    get reads() { return reads; },
    async fetchImpl(url, options) {
      requests.push({ url, ...options });
      if (url === "http://127.0.0.1:8787/health") return response({ ok: true, service: "jarvis-broker" });
      if (url === "http://127.0.0.1:8787/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe")
        return response({ events: [] });
      if (url === "http://127.0.0.1:8787/api/jarvis/admin/work/" + goalId) {
        reads += 1;
        assert.ok(reads <= 2, "the read-only probe must not retry or spin");
        if (reads === 2 && typeof second === "function") return second();
        return response(reads === 1 ? first : second);
      }
      throw Error("unexpected local request");
    },
  };
}
const check = h => probeLiveGoriqConnection({ mode: "broker", ownerToken, goalId, jobId, fetchImpl: h.fetchImpl });
function assertNoAuthority(result) {
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.mergeAuthorized, false);
  assert.equal(result.builderAcknowledged, false);
  assert.equal(result.actualBuilderReceiptId, null);
  assert.equal(result.actualTaskId, null);
  assert.doesNotMatch(JSON.stringify(result), /fixture-only-owner-token|private-transport-detail/);
}

test("explicit Job readback requires two matching authenticated local observations", async () => {
  const h = host(initial());
  const result = await check(h);
  assert.equal(h.reads, 2);
  assert.equal(result.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(result.localReadbackConsistent, true);
  assert.equal(result.goalContractDigest, "a".repeat(64));
  assert.equal(result.jobRecordSha256, "b".repeat(64));
  assert.equal(result.jobReadbackObserved, true);
  assert.equal(result.completionClaim, false);
  assertNoAuthority(result);
  assert.equal(h.requests.length, 4);
  for (const request of h.requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer " + ownerToken);
    assert.ok(request.signal instanceof globalThis.AbortSignal);
    assert.ok(request.url.startsWith("http://127.0.0.1:8787/"));
  }
});

const mutations = [
  ["current Goal identity", x => { x.goalAuthority.goalId = "goal-other-fixture"; }],
  ["current Goal authority", x => { x.goalAuthority.current = false; x.goalAuthority.kind = "HISTORICAL_WORK_RUN"; }],
  ["Goal contract digest", x => { x.jobReadback.goalDigest = "c".repeat(64); }],
  ["WorkRun identity", x => { x.run.goalId = "goal-other-fixture"; }],
  ["WorkRun stop state", x => { x.run.phase = "HUMAN_GATE"; }],
  ["Job state", x => { x.jobReadback.jobs[0].phase = "HUMAN_GATE"; }],
  ["Job record hash", x => { x.jobReadback.jobs[0].recordSha256 = "d".repeat(64); }],
  ["approval task scope", x => { x.jobReadback.jobs[0].approvalScope.taskScopeId = "issue:other"; }],
  ["approval risk ceiling", x => { x.jobReadback.jobs[0].approvalScope.maxRisk = "critical"; }],
  ["approval expiry", x => { x.jobReadback.jobs[0].approvalScope.expiresAt = "2099-01-01T00:00:00Z"; }],
  ["expired approval", x => { x.jobReadback.jobs[0].approvalScope.expiresAt = "2000-01-01T00:00:00Z"; }],
  ["missing exact Job", x => { x.jobReadback.jobs = []; }],
  ["duplicated exact Job", x => { x.jobReadback.jobs.push(clone(x.jobReadback.jobs[0])); }],
  ["unrecognized WorkRun phase", x => { x.run.phase = "SURPRISE"; }],
  ["missing readback envelope", x => { delete x.jobReadback; }],
];
for (const [name, mutate] of mutations) {
  test(`Job readback fails closed when the second observation changes ${name}`, async () => {
    const first = initial();
    const second = clone(first);
    mutate(second);
    const h = host(first, second);
    const result = await check(h);
    assert.equal(result.status, "HOLD");
    assert.equal(result.reason, "JOB_READBACK_CHANGED");
    assert.equal(result.jobReadbackObserved, false);
    assert.equal(result.localReadbackConsistent, false);
    assert.equal(result.goalContractDigest, null);
    assert.equal(h.reads, 2);
    assertNoAuthority(result);
  });
}
for (const [name, second] of [
  ["transport failure", () => { throw Error("private-transport-detail"); }],
  ["owner auth failure", () => ({ ok: false, status: 401 })],
  ["malformed response", () => ({ ok: true, text: async () => "private-transport-detail" })],
]) {
  test(`Job readback cannot pass after second-read ${name}`, async () => {
    const h = host(initial(), second);
    const result = await check(h);
    assert.equal(result.status, "HOLD");
    assert.equal(result.reason, "JOB_READBACK_REPEAT_UNAVAILABLE");
    assert.equal(result.localReadbackConsistent, false);
    assert.equal(result.jobReadbackObserved, false);
    assert.equal(h.reads, 2);
    assertNoAuthority(result);
  });
}
test("normalized Job binding ignores JSON key order and unrelated Job ordering", async () => {
  const first = initial();
  const other = { ...clone(first.jobReadback.jobs[0]), jobId: "job-other-fixture" };
  first.jobReadback.jobs.push(other);
  const second = clone(first);
  second.jobReadback.jobs.reverse();
  second.jobReadback.jobs[1].approvalScope = { maxRisk: "low", taskScopeId: "issue:1219" };
  const h = host(first, second);
  const result = await check(h);
  assert.equal(result.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(result.localReadbackConsistent, true);
  assert.equal(h.reads, 2);
  assertNoAuthority(result);
});
test("a stable Human Gate is observed without clearing it or granting execution", async () => {
  const snapshot = initial();
  snapshot.run.phase = "HUMAN_GATE";
  snapshot.jobReadback.jobs[0].phase = "HUMAN_GATE";
  const h = host(snapshot);
  const result = await check(h);
  assert.equal(result.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(result.jobReadbackPhase, "HUMAN_GATE");
  assert.equal(result.goalWorkRunPhase, "HUMAN_GATE");
  assert.equal(result.localReadbackConsistent, true);
  assert.equal(h.reads, 2);
  assertNoAuthority(result);
});
test("an invalid first Job snapshot retains its existing refusal without a repeat request", async () => {
  const snapshot = initial();
  snapshot.jobReadback.jobs = [];
  const h = host(snapshot);
  const result = await check(h);
  assert.equal(result.status, "HOLD");
  assert.equal(result.reason, "JOB_READBACK_NOT_AUTHENTICATED");
  assert.equal(h.reads, 1);
  assertNoAuthority(result);
});
test("Goal-only observations do not claim two-read Job consistency", async () => {
  const h = host(initial());
  const result = await probeLiveGoriqConnection({ mode: "broker", ownerToken, goalId, fetchImpl: h.fetchImpl });
  assert.equal(result.status, "BROKER_AUTHENTICATED_READONLY");
  assert.equal(result.localReadbackConsistent, false);
  assert.equal(result.goalContractDigest, null);
  assert.equal(result.jobReadbackObserved, false);
  assert.equal(h.reads, 1);
  assertNoAuthority(result);
});
