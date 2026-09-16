import { timingSafeEqual } from "node:crypto";

export const FIXED_ENROLLMENT_TTL_MS = 10 * 60_000;
export const FIXED_ENROLLMENT_MAX_DEVICES = 1;
export const FIXED_ENROLLMENT_RATE_WINDOW_MS = 60_000;
export const FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT = 8791;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export type FixedEnrollmentRequest = {
  mode: "quick";
  maxDevices: 1;
  ttlMs: number;
  group?: string;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type ClientWindow = {
  startedAt: number;
  count: number;
};

export function safeEqualEnrollmentKey(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeFixedEnrollmentBindHost(host: string | undefined, allowLan: boolean): string {
  const normalized = host?.trim() || "127.0.0.1";
  if (LOOPBACK_HOSTS.has(normalized)) return normalized;
  if (!allowLan) {
    throw new Error("Refusing non-loopback fixed-enrollment bind unless JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN=1");
  }
  return normalized;
}

export function normalizeFixedEnrollmentBrokerUrl(raw: string | undefined): string {
  const value = raw?.trim() || "http://127.0.0.1:8787";
  const parsed = new URL(value);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error("Fixed-enrollment portal Broker URL must remain loopback-only");
  if (parsed.username || parsed.password) throw new Error("Broker URL credentials are not allowed");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Broker URL must use HTTP or HTTPS");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeFixedEnrollmentGroup(group: string | undefined): string | undefined {
  const normalized = group?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 64) throw new Error("Enrollment group must be 64 characters or fewer");
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) throw new Error("Enrollment group contains unsupported characters");
  return normalized;
}

export function fixedEnrollmentRequest(group?: string): FixedEnrollmentRequest {
  const normalizedGroup = normalizeFixedEnrollmentGroup(group);
  return {
    mode: "quick",
    maxDevices: FIXED_ENROLLMENT_MAX_DEVICES,
    ttlMs: FIXED_ENROLLMENT_TTL_MS,
    ...(normalizedGroup ? { group: normalizedGroup } : {}),
  };
}

export function validateFixedEnrollmentRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Broker did not return a one-tap enrollment URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Fixed enrollment requires an HTTPS one-tap URL");
  if (parsed.username || parsed.password) throw new Error("Enrollment URL credentials are not allowed");
  return parsed.toString();
}

export class FixedEnrollmentRateLimiter {
  private globalStartedAt = 0;
  private globalCount = 0;
  private readonly clients = new Map<string, ClientWindow>();
  private readonly windowMs: number;
  private readonly perClientLimit: number;
  private readonly globalLimit: number;
  private readonly maxTrackedClients: number;

  constructor(
    windowMs = FIXED_ENROLLMENT_RATE_WINDOW_MS,
    perClientLimit = 6,
    globalLimit = 60,
    maxTrackedClients = 256,
  ) {
    if (windowMs <= 0 || perClientLimit <= 0 || globalLimit <= 0 || maxTrackedClients <= 0) {
      throw new Error("Rate-limit bounds must be positive");
    }
    this.windowMs = windowMs;
    this.perClientLimit = perClientLimit;
    this.globalLimit = globalLimit;
    this.maxTrackedClients = maxTrackedClients;
  }

  consume(clientKey: string, now = Date.now()): RateLimitResult {
    if (this.globalStartedAt === 0 || now - this.globalStartedAt >= this.windowMs) {
      this.globalStartedAt = now;
      this.globalCount = 0;
    }

    this.prune(now);
    const existing = this.clients.get(clientKey);
    const client = !existing || now - existing.startedAt >= this.windowMs
      ? { startedAt: now, count: 0 }
      : existing;

    if (!existing && this.clients.size >= this.maxTrackedClients) {
      return { allowed: false, retryAfterMs: this.windowMs };
    }

    const globalRetry = Math.max(1, this.windowMs - (now - this.globalStartedAt));
    if (this.globalCount >= this.globalLimit) return { allowed: false, retryAfterMs: globalRetry };

    const clientRetry = Math.max(1, this.windowMs - (now - client.startedAt));
    if (client.count >= this.perClientLimit) return { allowed: false, retryAfterMs: clientRetry };

    client.count += 1;
    this.globalCount += 1;
    this.clients.set(clientKey, client);
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number): void {
    for (const [key, value] of this.clients) {
      if (now - value.startedAt >= this.windowMs) this.clients.delete(key);
    }
  }
}
