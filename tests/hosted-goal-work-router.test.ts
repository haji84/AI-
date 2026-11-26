import assert from "node:assert/strict";
import test from "node:test";
import { routeDurableGoalJobs, type DurableGoalJob } from "../src/orchestrator/hosted-goal-work-router.ts";
import type { FabricNode } from "../src/orchestrator/capability-fabric-router.ts";

const cloud: FabricNode = { id: "github-hosted", kind: "cloud", capabilities: ["inspect", "ci", "review"], online: true, healthy: true, privacy: "public-ok", incrementalCost: 0, latencyMs: 200, reliability: .9, evidenceModes: ["ONLINE"] };
const zbook: FabricNode = { id: "zbook", kind: "local", capabilities: ["local-model", "gpu", "windows"], online: false, healthy: false, privacy: "local-only", incrementalCost: 0, latencyMs: 30, reliability: .99, evidenceModes: ["LOCAL"] };
const basic = (id: string, caps: string[], overrides: Partial<DurableGoalJob> = {}): DurableGoalJob => ({
  goalId: "goal-1219", job: { id, requiredCapabilities: caps, privacy: "public", freshness: "static", risk: "low", evidenceMode: "ONLINE" }, phase: "QUEUED", ...overrides,
});

test("GitHub review and CI stay runnable while ZBook is offline; local-only work waits", () => {
  const list = [basic("review", ["review"]), basic("ci", ["ci"]), basic("local", ["local-model"], {
    job: { id: "local", requiredCapabilities: ["local-model"], privacy: "secret", freshness: "static", risk: "low", evidenceMode: "LOCAL" },
  })];
  const result = routeDurableGoalJobs(list, [cloud, zbook]);
  assert.deepEqual(result.map((x) => x.disposition), ["RUN_HOSTED", "RUN_HOSTED", "WAITING_FOR_CAPABILITY"]);
  assert.deepEqual(result.map((x) => x.nodeId), ["github-hosted", "github-hosted", null]);
  assert.deepEqual(result.map((x) => x.goalId), ["goal-1219", "goal-1219", "goal-1219"]);
  assert.equal(zbook.online, false);
});

test("after returning ZBook is verified online, only its required Job is routed there", () => {
  const local = basic("local", ["local-model"], { job: { id: "local", requiredCapabilities: ["local-model"], privacy: "secret", freshness: "static", risk: "low", evidenceMode: "LOCAL" } });
  const result = routeDurableGoalJobs([basic("ci", ["ci"]), local], [cloud, { ...zbook, online: true, healthy: true }]);
  assert.deepEqual(result.map((x) => x.disposition), ["RUN_HOSTED", "RUN_OWNER_WORKER"]);
  assert.equal(result[1]?.nodeId, "zbook");
});

test("an independent hosted Job proceeds while another Job awaits verified predecessor", () => {
  const predecessor = basic("model", ["local-model"], { job: { id: "model", requiredCapabilities: ["local-model"], privacy: "secret", freshness: "static", risk: "low", evidenceMode: "LOCAL" } });
  const dependent = basic("dependent", ["ci"], { dependsOn: ["model"] });
  const independent = basic("review", ["review"]);
  assert.deepEqual(routeDurableGoalJobs([predecessor, dependent, independent], [cloud, zbook]).map((x) => x.disposition),
    ["WAITING_FOR_CAPABILITY", "WAITING_FOR_DEPENDENCY", "RUN_HOSTED"]);
});

test("successor Job requires verified predecessor; a worker self-report never suffices", () => {
  const predecessor = basic("first", ["ci"], { phase: "COMPLETED", verified: false });
  const second = basic("second", ["review"], { dependsOn: ["first"] });
  assert.deepEqual(routeDurableGoalJobs([predecessor, second], [cloud]).map((x) => x.disposition), ["WAITING_FOR_VERIFICATION", "WAITING_FOR_DEPENDENCY"]);
  const verified = { ...predecessor, verified: true };
  assert.deepEqual(routeDurableGoalJobs([verified, second], [cloud]).map((x) => x.disposition), ["ALREADY_VERIFIED", "RUN_HOSTED"]);
});

test("HIGH, critical, and explicit Human Gates cannot be bypassed by hosted routing", () => {
  const high = basic("high", ["review"], { job: { ...basic("high", ["review"]).job, risk: "high" } });
  const critical = basic("critical", ["ci"], { job: { ...basic("critical", ["ci"]).job, risk: "critical" } });
  const explicit = basic("exp", ["review"], { humanApprovalRequired: true });
  assert.deepEqual(routeDurableGoalJobs([high, critical, explicit], [cloud]).map((x) => x.disposition), ["HUMAN_REQUIRED", "HUMAN_REQUIRED", "HUMAN_REQUIRED"]);
});

test("private or sensitive work, unavailable capabilities and paid nodes never silently execute on hosted", () => {
  const secret = basic("secret", ["inspect"], { job: { ...basic("secret", ["inspect"]).job, privacy: "secret" } });
  const sensitive = basic("sensitive", ["inspect"], { job: { ...basic("sensitive", ["inspect"]).job, privacy: "sensitive" } });
  const unknown = basic("unknown", ["uninstalled-capability"]);
  const paid = { ...cloud, id: "paid-hosted", incrementalCost: 1 };
  const result = routeDurableGoalJobs([secret, sensitive, unknown], [cloud, paid, zbook]);
  assert.deepEqual(result.map((x) => x.disposition), ["WAITING_FOR_CAPABILITY", "WAITING_FOR_CAPABILITY", "WAITING_FOR_CAPABILITY"]);
  assert.equal(routeDurableGoalJobs([basic("review", ["review"])], [paid])[0]?.disposition, "WAITING_FOR_CAPABILITY");
});

test("an in-flight Job is not duplicated and an explicit pause remains stopped", () => {
  assert.deepEqual(routeDurableGoalJobs([basic("started", ["ci"], { phase: "RUNNING" }), basic("paused", ["review"], { phase: "PAUSED" }), basic("blocked", ["review"], { phase: "BLOCKED" })], [cloud]).map((x) => x.disposition),
    ["IN_PROGRESS", "PAUSED", "BLOCKED"]);
});

test("foreign, missing, cyclic, duplicate and unbounded work is rejected before routing", () => {
  assert.throws(() => routeDurableGoalJobs([basic("x", ["ci"]), basic("x", ["ci"])], [cloud]), /DUPLICATE_JOB/);
  assert.throws(() => routeDurableGoalJobs([basic("a", ["ci"], { dependsOn: ["b"] })], [cloud]), /MISSING_DEPENDENCY/);
  assert.throws(() => routeDurableGoalJobs([basic("a", ["ci"], { dependsOn: ["b"] }), basic("b", ["ci"], { dependsOn: ["a"] })], [cloud]), /DEPENDENCY_CYCLE/);
  assert.throws(() => routeDurableGoalJobs(Array.from({ length: 65 }, (_, i) => basic(`j${i}`, ["ci"])), [cloud]), /JOB_LIMIT/);
});

test("runtime-invalid risk and privacy never create an authority loophole", () => {
  const unknownRisk = basic("bad-risk", ["review"], { job: { ...basic("bad-risk", ["review"]).job, risk: "other" as "low" } });
  const unknownPrivacy = basic("bad-privacy", ["review"], { job: { ...basic("bad-privacy", ["review"]).job, privacy: "private" as "public" } });
  const unsafeNode = { ...cloud, incrementalCost: NaN };
  assert.throws(() => routeDurableGoalJobs([unknownRisk], [cloud]), /INVALID_JOB/);
  assert.throws(() => routeDurableGoalJobs([unknownPrivacy], [cloud]), /INVALID_JOB/);
  assert.throws(() => routeDurableGoalJobs([basic("review", ["review"])], [unsafeNode]), /INVALID_NODE/);
});

test("composite Goal IDs cannot alias one another via separator collision", () => {
  const a = basic("b", ["ci"], { goalId: "goal:x" });
  const b = basic("x:b", ["ci"], { goalId: "goal" });
  assert.deepEqual(routeDurableGoalJobs([a,b], [cloud]).map((route) => route.disposition), ["RUN_HOSTED", "RUN_HOSTED"]);
});


test("duplicate runner identities and malformed Goal IDs are rejected", () => {
  assert.throws(() => routeDurableGoalJobs([basic("inspect", ["inspect"])], [cloud, cloud]), /DUPLICATE_NODE/);
  assert.throws(() => routeDurableGoalJobs([basic("inspect", ["inspect"], { goalId: "bad goal" })], [cloud]), /INVALID_JOB/);
});
