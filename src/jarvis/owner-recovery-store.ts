import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type PendingVerification = {
  purpose: "register" | "recover";
  address: string;
  digest: string;
  expiresAt: string;
  attempts: number;
};
type RecoveryState = {
  version: 1;
  verifiedAddress?: string;
  verifiedAt?: string;
  pending?: PendingVerification;
  lastIssuedAt?: string;
  restrictedUntil?: string;
  events: Array<{ at: string; event: string }>;
};
export type RecoveryCodeDelivery = (input: { address: string; code: string; purpose: "register" | "recover"; expiresAt: string }) => Promise<void>;

const TTL_MS = 10 * 60_000;
const COOLDOWN_MS = 60_000;
const RESTRICT_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 5;

function normalizeAddress(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid recovery email required");
  return email;
}
function digest(secret: string, purpose: string, address: string, code: string) {
  return createHmac("sha256", secret).update([purpose, address, code].join("\n")).digest("hex");
}
function safeHex(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class OwnerRecoveryStore {
  private readonly file: string;
  private readonly secret: string;

  constructor(file: string, secret: string) {
    if (!secret.trim()) throw new Error("recovery secret required");
    this.file = file;
    this.secret = secret;
  }
  private read(): RecoveryState {
    if (!existsSync(this.file)) return { version: 1, events: [] };
    const raw = readFileSync(this.file, "utf8");
    if (raw.length > 64_000) throw new Error("recovery state too large");
    const state = JSON.parse(raw) as RecoveryState;
    if (state.version !== 1 || !Array.isArray(state.events)) throw new Error("invalid recovery state");
    return state;
  }
  private save(state: RecoveryState) {
    mkdirSync(dirname(this.file), { recursive: true });
    const bounded = { ...state, events: state.events.slice(-100) };
    writeFileSync(this.file + ".tmp", JSON.stringify(bounded), { mode: 0o600 });
    renameSync(this.file + ".tmp", this.file);
  }
  private event(state: RecoveryState, event: string, now: Date): RecoveryState {
    return { ...state, events: [...state.events, { at: now.toISOString(), event }].slice(-100) };
  }
  status(now = new Date()) {
    const state = this.read();
    return {
      configured: Boolean(state.verifiedAddress),
      maskedEmail: state.verifiedAddress?.replace(/^(.).+(@.+)$/, "$1***$2"),
      verifiedAt: state.verifiedAt,
      restrictedUntil: state.restrictedUntil && Date.parse(state.restrictedUntil) > now.getTime() ? state.restrictedUntil : undefined,
      events: state.events.slice(-20),
    };
  }
  async startRegistration(address: string, deliver: RecoveryCodeDelivery, now = new Date()) {
    return this.issue("register", normalizeAddress(address), deliver, now);
  }
  async startRecovery(address: string, deliver: RecoveryCodeDelivery, now = new Date()) {
    const state = this.read();
    const normalized = normalizeAddress(address);
    if (!state.verifiedAddress || state.verifiedAddress !== normalized) return { accepted: true };
    await this.issue("recover", normalized, deliver, now);
    return { accepted: true };
  }
  private async issue(purpose: "register" | "recover", address: string, deliver: RecoveryCodeDelivery, now: Date) {
    let state = this.read();
    if (state.lastIssuedAt && now.getTime() - Date.parse(state.lastIssuedAt) < COOLDOWN_MS) throw new Error("verification request rate limited");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    const pending = { purpose, address, digest: digest(this.secret, purpose, address, code), expiresAt, attempts: 0 } satisfies PendingVerification;
    await deliver({ address, code, purpose, expiresAt });
    state = this.event({ ...state, pending, lastIssuedAt: now.toISOString() }, purpose === "register" ? "recovery-email.code-sent" : "owner-recovery.code-sent", now);
    this.save(state);
    return { accepted: true, expiresAt };
  }
  verifyRegistration(code: string, now = new Date()) {
    let state = this.read();
    const pending = state.pending;
    if (!pending || pending.purpose !== "register" || Date.parse(pending.expiresAt) < now.getTime()) throw new Error("verification code unavailable");
    if (!safeHex(pending.digest, digest(this.secret, pending.purpose, pending.address, code))) {
      const attempts = pending.attempts + 1;
      state = { ...state, pending: attempts >= MAX_ATTEMPTS ? undefined : { ...pending, attempts } };
      this.save(this.event(state, "recovery-email.code-rejected", now));
      throw new Error("verification code rejected");
    }
    state = { ...state, verifiedAddress: pending.address, verifiedAt: now.toISOString(), pending: undefined };
    this.save(this.event(state, "recovery-email.verified", now));
    return this.status(now);
  }
  verifyRecovery(code: string, now = new Date()) {
    let state = this.read();
    const pending = state.pending;
    if (!pending || pending.purpose !== "recover" || Date.parse(pending.expiresAt) < now.getTime()) throw new Error("verification code unavailable");
    if (!safeHex(pending.digest, digest(this.secret, pending.purpose, pending.address, code))) {
      const attempts = pending.attempts + 1;
      state = { ...state, pending: attempts >= MAX_ATTEMPTS ? undefined : { ...pending, attempts } };
      this.save(this.event(state, "owner-recovery.code-rejected", now));
      throw new Error("verification code rejected");
    }
    const restrictedUntil = new Date(now.getTime() + RESTRICT_MS).toISOString();
    state = { ...state, pending: undefined, restrictedUntil };
    this.save(this.event(state, "owner-recovery.verified", now));
    return { restrictedUntil };
  }
}
