export const JARVIS_PAIRING_WINDOW_DEFAULT_TTL_MS = 10 * 60_000;
export const JARVIS_PAIRING_WINDOW_MAX_TTL_MS = 60 * 60_000;
export const JARVIS_PAIRING_WINDOW_MIN_TTL_MS = 60_000;
export const JARVIS_PAIRING_WINDOW_MAX_ISSUES = 100;
export const JARVIS_PAIRING_GRANT_MAX_TTL_MS = 10 * 60_000;

export type JarvisPairingWindowStatus = {
  open: boolean;
  reason: "open" | "closed" | "expired" | "exhausted";
  openedAt?: string;
  expiresAt?: string;
  maxIssues: number;
  issued: number;
  remaining: number;
  group?: string;
};

type WindowState = {
  openedAtMs: number;
  expiresAtMs: number;
  maxIssues: number;
  issued: number;
  group?: string;
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function normalizeGroup(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("pairing group must be a string");
  const group = value.trim();
  if (!group) return undefined;
  if (group.length > 64) throw new Error("pairing group must be 64 characters or fewer");
  if (!/^[A-Za-z0-9._:-]+$/.test(group)) throw new Error("pairing group contains unsupported characters");
  return group;
}

export class JarvisEnrollmentPairingWindow {
  private state?: WindowState;
  private lastReason: "closed" | "expired" | "exhausted" = "closed";

  open(input: { ttlMs?: number; maxIssues?: number; group?: string }, now = Date.now()): JarvisPairingWindowStatus {
    const ttlMs = boundedInteger(
      input.ttlMs,
      JARVIS_PAIRING_WINDOW_DEFAULT_TTL_MS,
      JARVIS_PAIRING_WINDOW_MIN_TTL_MS,
      JARVIS_PAIRING_WINDOW_MAX_TTL_MS,
    );
    const maxIssues = boundedInteger(input.maxIssues, JARVIS_PAIRING_WINDOW_MAX_ISSUES, 1, JARVIS_PAIRING_WINDOW_MAX_ISSUES);
    const group = normalizeGroup(input.group);
    this.state = { openedAtMs: now, expiresAtMs: now + ttlMs, maxIssues, issued: 0, group };
    this.lastReason = "closed";
    return this.status(now);
  }

  close(now = Date.now()): JarvisPairingWindowStatus {
    this.state = undefined;
    this.lastReason = "closed";
    return this.status(now);
  }

  status(now = Date.now()): JarvisPairingWindowStatus {
    const state = this.state;
    if (!state) return { open: false, reason: this.lastReason, maxIssues: 0, issued: 0, remaining: 0 };
    if (now >= state.expiresAtMs) {
      this.state = undefined;
      this.lastReason = "expired";
      return { open: false, reason: "expired", maxIssues: state.maxIssues, issued: state.issued, remaining: 0, group: state.group };
    }
    if (state.issued >= state.maxIssues) {
      this.state = undefined;
      this.lastReason = "exhausted";
      return { open: false, reason: "exhausted", maxIssues: state.maxIssues, issued: state.issued, remaining: 0, group: state.group };
    }
    return {
      open: true,
      reason: "open",
      openedAt: new Date(state.openedAtMs).toISOString(),
      expiresAt: new Date(state.expiresAtMs).toISOString(),
      maxIssues: state.maxIssues,
      issued: state.issued,
      remaining: state.maxIssues - state.issued,
      group: state.group,
    };
  }

  reserveIssue(now = Date.now()): { status: JarvisPairingWindowStatus; grantTtlMs: number; group?: string } | undefined {
    const before = this.status(now);
    if (!before.open || !this.state) return undefined;
    const state = this.state;
    state.issued += 1;
    const remainingWindowMs = Math.max(1, state.expiresAtMs - now);
    const grantTtlMs = Math.min(JARVIS_PAIRING_GRANT_MAX_TTL_MS, remainingWindowMs);
    const status = this.status(now);
    return { status, grantTtlMs, group: state.group };
  }
}
