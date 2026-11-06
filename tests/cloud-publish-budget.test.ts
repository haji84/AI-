import assert from "node:assert/strict";
import test from "node:test";
import {
  reserveCloudPublishAttempt,
  type CloudPublishAttempt,
  type CloudPublishLedger,
  type SharedCloudPublishStore,
} from "../src/orchestrator/cloud-publish-budget.ts";

const NOW = "2026-10-17T04:30:00.000Z";
const BASE_USAGE = {
  accountId: "account-1",
  observedAt: NOW,
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-11-01T00:00:00.000Z",
  pagesBuildsThisPeriod: 0,
  pagesBuildsLast24Hours: 0,
  workersBuildMinutesThisPeriod: 0,
  freeNonBillableVerified: true,
  exclusiveDeploymentChannelVerified: true,
};
const REV = "a".repeat(40);

function makeStore(): SharedCloudPublishStore & { state: CloudPublishLedger } {
  return {
    accountId: "account-1", distributedAtomic: true,
    state: { version: 0, reservations: [] },
    async read() { return structuredClone(this.state); },
    async compareAndSwap(expected, next) {
      if (this.state.version !== expected) return false;
      this.state = structuredClone(next);
      return true;
    },
  };
}
function attempt(id: string, platform: "pages" | "workers" = "pages", overrides: Partial<CloudPublishAttempt> = {}): CloudPublishAttempt {
  return { id, accountId: "account-1", projectId: "goriq", platform, revision: REV, now: NOW,
    releaseGatePassed: true, productionHumanGatePassed: true, usage: { ...BASE_USAGE }, ...overrides };
}

test("fail closed when release gates, shared account or verified nonbillable usage is absent", async () => {
  const s = makeStore();
  assert.equal((await reserveCloudPublishAttempt(s, attempt("no-gate", "pages", { releaseGatePassed: false }))).status, "BLOCKED");
  assert.equal((await reserveCloudPublishAttempt(s, attempt("no-human", "pages", { productionHumanGatePassed: false }))).status, "BLOCKED");
  assert.equal((await reserveCloudPublishAttempt(s, attempt("no-cost", "pages", { usage: { ...BASE_USAGE, freeNonBillableVerified: false } }))).status, "BLOCKED");
  assert.equal((await reserveCloudPublishAttempt(s, attempt("no-exclusive", "pages", { usage: { ...BASE_USAGE, exclusiveDeploymentChannelVerified: false } }))).status, "BLOCKED");
  assert.equal((await reserveCloudPublishAttempt(s, attempt("stale", "pages", { usage: { ...BASE_USAGE, observedAt: "2026-10-17T04:24:00.000Z" } }))).status, "BLOCKED");
  assert.equal((await reserveCloudPublishAttempt(s, attempt("wrong-account", "pages", { accountId: "other" }))).status, "BLOCKED");
  assert.equal(s.state.reservations.length, 0);
});

test("Pages blocks the 11th rolling-day attempt across multiple projects", async () => {
  const s = makeStore();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserveCloudPublishAttempt(s,
    attempt("daily-" + i, "pages", { projectId: i % 2 ? "race" : "goriq" }))));
  assert.equal(results.filter((x) => x.status === "RESERVED").length, 10);
  assert.equal(results.filter((x) => x.status === "BLOCKED" && x.reason === "pages_rolling_day_budget_exhausted").length, 2);
});

test("Pages blocks the 301st monthly attempt, including imported monthly usage", async () => {
  const s = makeStore();
  const usage = { ...BASE_USAGE, pagesBuildsThisPeriod: 299 };
  assert.equal((await reserveCloudPublishAttempt(s, attempt("300", "pages", { usage }))).status, "RESERVED");
  assert.deepEqual(await reserveCloudPublishAttempt(s, attempt("301", "pages", { usage })),
    { status: "BLOCKED", reason: "pages_monthly_budget_exhausted" });
});

test("Workers reserves worst-case minutes; 2700th fits but another 20-minute build is rejected", async () => {
  const s = makeStore();
  const usage = { ...BASE_USAGE, workersBuildMinutesThisPeriod: 2680 };
  const first = await reserveCloudPublishAttempt(s, attempt("minutes-2700", "workers", { usage }));
  assert.equal(first.status, "RESERVED");
  if (first.status === "RESERVED") assert.equal(first.reservation.reservedBuildMinutes, 20);
  assert.deepEqual(await reserveCloudPublishAttempt(s, attempt("minutes-2720", "workers", { usage })),
    { status: "BLOCKED", reason: "workers_build_minutes_budget_exhausted" });
});

test("duplicate attempts cannot authorize a second deployment", async () => {
  const s = makeStore();
  assert.equal((await reserveCloudPublishAttempt(s, attempt("idem", "workers"))).status, "RESERVED");
  assert.deepEqual(await reserveCloudPublishAttempt(s, attempt("idem", "workers")),
    { status: "BLOCKED", reason: "duplicate_attempt_id" });
});

test("billing period rollover preserves audit but permits next period", async () => {
  const s = makeStore();
  const usage = { ...BASE_USAGE, pagesBuildsThisPeriod: 299 };
  assert.equal((await reserveCloudPublishAttempt(s, attempt("old", "pages", { usage }))).status, "RESERVED");
  const now = "2026-11-01T00:06:00.000Z";
  const nextUsage = { ...BASE_USAGE, observedAt: now, periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2026-12-01T00:00:00.000Z" };
  assert.equal((await reserveCloudPublishAttempt(s, attempt("new", "pages", { now, usage: nextUsage }))).status, "RESERVED");
  assert.equal(s.state.reservations.length, 2);
});

test("corrupt state and store write errors fail closed", async () => {
  const s = makeStore();
  s.state.reservations = [{ id: "malformed" } as never];
  assert.deepEqual(await reserveCloudPublishAttempt(s, attempt("bad")),
    { status: "BLOCKED", reason: "shared_ledger_invalid" });
  const broken = makeStore();
  broken.compareAndSwap = async () => { throw new Error("down"); };
  assert.deepEqual(await reserveCloudPublishAttempt(broken, attempt("unwritten")),
    { status: "BLOCKED", reason: "shared_ledger_write_failed" });
});
