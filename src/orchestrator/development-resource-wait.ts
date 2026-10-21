import { ResourceWaitError, type ResourceWaitOutcome } from "../gai/development-resource-admission.ts";

export interface DevelopmentResourceWait {
  firstObservedAt: string;
  retryAt: string;
  deadline: string;
  checks: number;
  reason: string;
}

export const MAX_RESOURCE_WAITS = 20;
export const RESOURCE_WAIT_DEADLINE_MS = 30 * 60_000;

export function assertResourceWait(value: DevelopmentResourceWait): void {
  if (!value || ![value.firstObservedAt, value.retryAt, value.deadline].every(v => typeof v === "string" && Number.isFinite(Date.parse(v)))
    || !Number.isInteger(value.checks) || value.checks < 1 || value.checks > MAX_RESOURCE_WAITS
    || typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 200
    || Date.parse(value.deadline) - Date.parse(value.firstObservedAt) !== RESOURCE_WAIT_DEADLINE_MS
    || Date.parse(value.retryAt) < Date.parse(value.firstObservedAt)
    || Date.parse(value.retryAt) > Date.parse(value.deadline)) throw Error("invalid resource wait checkpoint");
}

export function resourceWaitExhausted(value: DevelopmentResourceWait, now: Date): boolean {
  assertResourceWait(value);
  return now.getTime() >= Date.parse(value.deadline) || value.checks >= MAX_RESOURCE_WAITS;
}

export function nextResourceWait(previous: DevelopmentResourceWait | undefined, outcome: ResourceWaitOutcome, now: Date): DevelopmentResourceWait {
  if (previous) assertResourceWait(previous);
  const first = previous?.firstObservedAt ?? now.toISOString();
  const deadline = previous?.deadline ?? new Date(now.getTime() + RESOURCE_WAIT_DEADLINE_MS).toISOString();
  const delay = Math.min(60_000, Math.max(1_000, Number.isFinite(outcome.retryAfterMs) ? outcome.retryAfterMs : 30_000));
  const next = {
    firstObservedAt: first, deadline,
    retryAt: new Date(Math.min(Date.parse(deadline), now.getTime() + delay)).toISOString(),
    checks: (previous?.checks ?? 0) + 1,
    reason: outcome.reason.trim().slice(0, 200) || "resource unavailable",
  };
  assertResourceWait(next);
  return next;
}

/** Only the small typed wait envelope is accepted; remote evidence is never execution authority. */
export function resourceWaitFromEvidence(value: unknown): ResourceWaitError | null {
  // Bound untrusted nesting even for a cyclic in-process evidence object.
  for (let depth = 0; depth < 4; depth++) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as { resourceWait?: unknown; remoteEvidence?: unknown };
  const wait = item.resourceWait;
  if (!wait || typeof wait !== "object" || Array.isArray(wait)) {
    value = item.remoteEvidence;
    continue;
  }
  const w = wait as Partial<ResourceWaitOutcome>;
  if (w.status !== "WAITING_FOR_RESOURCE" || typeof w.reason !== "string" || !w.reason.trim()
    || w.reason.length > 200 || !Number.isInteger(w.retryAfterMs) || w.retryAfterMs! < 1000 || w.retryAfterMs! > 60_000
    || typeof w.observedAt !== "string" || !Number.isFinite(Date.parse(w.observedAt))) return null;
  return new ResourceWaitError({ status: w.status, reason: w.reason, retryAfterMs: w.retryAfterMs!, observedAt: w.observedAt });
  }
  return null;
}
