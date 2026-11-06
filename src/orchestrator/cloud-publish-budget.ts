/**
 * Fail-closed shared reservation gate for external Cloudflare build attempts.
 * Does NOT deploy or grant authorization. Production callers must verify the
 * existing Human Gate and provide a durable cross-project atomic CAS store.
 * Provider usage and reservations are added conservatively: double counting
 * is preferable to silently permitting a paid overage.
 */
export type PublishPlatform = "pages" | "workers";

export interface CloudBuildUsageSnapshot {
  accountId: string;
  observedAt: string;
  periodStart: string;
  periodEnd: string;
  pagesBuildsThisPeriod: number;
  pagesBuildsLast24Hours: number;
  workersBuildMinutesThisPeriod: number;
  freeNonBillableVerified: boolean;
  exclusiveDeploymentChannelVerified: boolean;
}

export interface CloudPublishReservation {
  id: string;
  accountId: string;
  projectId: string;
  platform: PublishPlatform;
  revision: string;
  createdAt: string;
  periodStart: string;
  reservedBuildMinutes: number;
}

export interface CloudPublishLedger {
  version: number;
  reservations: CloudPublishReservation[];
}

export interface SharedCloudPublishStore {
  readonly accountId: string;
  readonly distributedAtomic: true;
  read(): Promise<CloudPublishLedger>;
  compareAndSwap(expectedVersion: number, next: CloudPublishLedger): Promise<boolean>;
}

export interface CloudPublishAttempt {
  id: string;
  accountId: string;
  projectId: string;
  platform: PublishPlatform;
  revision: string;
  now: string;
  releaseGatePassed: boolean;
  productionHumanGatePassed: boolean;
  usage: CloudBuildUsageSnapshot | null;
}

export type CloudPublishDecision =
  | { status: "RESERVED"; reservation: CloudPublishReservation }
  | { status: "BLOCKED"; reason: string };

const ROLLING_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 32;

export const CLOUD_PUBLISH_LIMITS = Object.freeze({
  pagesDailyAttemptTarget: 10,
  pagesMonthlyAttemptTarget: 300,
  pagesFreeProviderLimit: 500,
  workersFreeBuildMinutes: 3000,
  workersOperationalMinutesTarget: 2700,
  workersMaxSingleBuildMinutes: 20,
});

function timestamp(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 19) === value.slice(0, 19) ? result : NaN;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validReservation(value: CloudPublishReservation): boolean {
  return !!value && typeof value.id === "string" && value.id.length > 0
    && typeof value.accountId === "string" && value.accountId.length > 0
    && typeof value.projectId === "string" && value.projectId.length > 0
    && (value.platform === "pages" || value.platform === "workers")
    && typeof value.revision === "string" && /^[a-f0-9]{40,64}$/.test(value.revision)
    && Number.isFinite(timestamp(value.createdAt)) && Number.isFinite(timestamp(value.periodStart))
    && nonnegativeInteger(value.reservedBuildMinutes)
    && (value.platform === "workers" ? value.reservedBuildMinutes === 20 : value.reservedBuildMinutes === 0);
}

/**
 * Atomic reservation only, NOT an external publish. A duplicate ID is blocked
 * rather than authorizing a second run. Workers reserve the 20-minute maximum
 * build runtime until an independent usage reconciliation is implemented.
 */
export async function reserveCloudPublishAttempt(
  store: SharedCloudPublishStore,
  attempt: CloudPublishAttempt,
): Promise<CloudPublishDecision> {
  const block = (reason: string): CloudPublishDecision => ({ status: "BLOCKED", reason });
  if (!attempt.releaseGatePassed || !attempt.productionHumanGatePassed) return block("release_or_human_gate_missing");
  if (!store || store.distributedAtomic !== true || store.accountId !== attempt.accountId) return block("shared_atomic_store_unavailable");
  if (typeof attempt.id !== "string" || !attempt.id || typeof attempt.accountId !== "string" || !attempt.accountId
      || typeof attempt.projectId !== "string" || !attempt.projectId || typeof attempt.revision !== "string" || !/^[a-f0-9]{40,64}$/.test(attempt.revision)) return block("invalid_release_identity");
  if (attempt.platform !== "pages" && attempt.platform !== "workers") return block("unsupported_platform");

  const nowMs = timestamp(attempt.now);
  const u = attempt.usage;
  if (!Number.isFinite(nowMs) || !u || u.accountId !== attempt.accountId || !u.freeNonBillableVerified || !u.exclusiveDeploymentChannelVerified) return block("missing_trusted_nonbillable_usage");
  const observedMs = timestamp(u.observedAt);
  const periodStartMs = timestamp(u.periodStart);
  const periodEndMs = timestamp(u.periodEnd);
  if (![observedMs, periodStartMs, periodEndMs].every(Number.isFinite) || periodEndMs <= periodStartMs || nowMs < periodStartMs || nowMs >= periodEndMs
      || observedMs > nowMs || nowMs - observedMs > MAX_SNAPSHOT_AGE_MS) return block("stale_or_invalid_usage_period");
  if (![u.pagesBuildsThisPeriod, u.pagesBuildsLast24Hours].every(nonnegativeInteger)
      || !Number.isFinite(u.workersBuildMinutesThisPeriod) || u.workersBuildMinutesThisPeriod < 0) return block("invalid_usage_counters");

  for (let i = 0; i < MAX_CAS_ATTEMPTS; i++) {
    let ledger: CloudPublishLedger;
    try { ledger = await store.read(); } catch { return block("shared_ledger_read_failed"); }
    if (!ledger || !nonnegativeInteger(ledger.version) || !Array.isArray(ledger.reservations)
        || !ledger.reservations.every(validReservation) || ledger.reservations.some((r) => r.accountId !== attempt.accountId)) return block("shared_ledger_invalid");
    if (ledger.reservations.some((r) => r.id === attempt.id)) return block("duplicate_attempt_id");
    const currentPeriod = ledger.reservations.filter((r) => {
      const createdMs = timestamp(r.createdAt);
      return createdMs >= periodStartMs && createdMs < periodEndMs;
    });
    const recent = ledger.reservations.filter((r) => {
      const t = timestamp(r.createdAt);
      return t <= nowMs && t > nowMs - ROLLING_DAY_MS;
    });

    if (attempt.platform === "pages") {
      const monthlyAttempts = currentPeriod.filter((r) => r.platform === "pages").length;
      const dailyAttempts = recent.filter((r) => r.platform === "pages").length;
      if (u.pagesBuildsThisPeriod + monthlyAttempts + 1 > CLOUD_PUBLISH_LIMITS.pagesMonthlyAttemptTarget
          || u.pagesBuildsThisPeriod + monthlyAttempts + 1 > CLOUD_PUBLISH_LIMITS.pagesFreeProviderLimit) return block("pages_monthly_budget_exhausted");
      if (u.pagesBuildsLast24Hours + dailyAttempts + 1 > CLOUD_PUBLISH_LIMITS.pagesDailyAttemptTarget) return block("pages_rolling_day_budget_exhausted");
    } else {
      const reserved = currentPeriod.reduce((sum, r) => sum + (r.platform === "workers" ? r.reservedBuildMinutes : 0), 0);
      if (u.workersBuildMinutesThisPeriod + reserved + CLOUD_PUBLISH_LIMITS.workersMaxSingleBuildMinutes > CLOUD_PUBLISH_LIMITS.workersOperationalMinutesTarget
          || u.workersBuildMinutesThisPeriod + reserved + CLOUD_PUBLISH_LIMITS.workersMaxSingleBuildMinutes > CLOUD_PUBLISH_LIMITS.workersFreeBuildMinutes) return block("workers_build_minutes_budget_exhausted");
    }
    const reservation: CloudPublishReservation = {
      id: attempt.id, accountId: attempt.accountId, projectId: attempt.projectId,
      platform: attempt.platform, revision: attempt.revision, createdAt: attempt.now,
      periodStart: u.periodStart, reservedBuildMinutes: attempt.platform === "workers" ? CLOUD_PUBLISH_LIMITS.workersMaxSingleBuildMinutes : 0,
    };
    let ok: boolean;
    try {
      ok = await store.compareAndSwap(ledger.version, { version: ledger.version + 1, reservations: [...ledger.reservations, reservation] });
    } catch { return block("shared_ledger_write_failed"); }
    if (ok) return { status: "RESERVED", reservation };
  }
  return block("concurrent_reservation_contention");
}
