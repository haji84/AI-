import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;
const BOUNDED_DIGEST = /^[A-Za-z0-9_-]{43}$/;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_TTL_SECONDS = 300;
const ISSUE_WINDOW_SECONDS = 3600;
const REDEEM_WINDOW_SECONDS = 300;
const ISSUE_LIMIT = 3;
const SOURCE_REDEEM_LIMIT = 10;
const GLOBAL_REDEEM_LIMIT = 100;
const MAX_DEVICES = 1000;
const MAX_HISTORY = 100;
const MAX_ISSUE_EVENTS = MAX_DEVICES * ISSUE_LIMIT;
const MAX_REGISTRY_BYTES = 512 * 1024;

export class OwnerRecoveryRejectedError extends Error {
  constructor(message = "owner recovery rejected") { super(message); }
}

type Device = { deviceId: string; label: string; revoked: boolean };
type RecoveryStatus = "active" | "consumed" | "cancelled" | "replaced" | "expired" | "issuer-revoked";
type RecoveryRecord = {
  version: 1;
  recoveryId: string;
  codeDigest: string;
  issuerDeviceId: string;
  issuedAt: number;
  expiresAt: number;
  status: RecoveryStatus;
  endedAt?: number;
  consumedAt?: number;
  targetDeviceId?: string;
  publicKeyThumbprint?: string;
};
type IssueEvent = { issuerDeviceId: string; issuedAt: number };
type AttemptEvent = { sourceBucket: string; attemptedAt: number };
type RecoveryState = { active?: RecoveryRecord; history: RecoveryRecord[]; issues: IssueEvent[]; attempts: AttemptEvent[] };
type Registry = { version: 1; devices: Device[]; recovery?: RecoveryState };
type RegistryWriter = (path: string, registry: Registry) => void;

function atomicWrite(path: string, registry: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(registry));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function recoveryState(registry: Registry): RecoveryState {
  if (!registry.recovery) registry.recovery = { history: [], issues: [], attempts: [] };
  return registry.recovery;
}

function validInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateRecord(record: RecoveryRecord, active: boolean): void {
  if (!record || record.version !== 1 || !BOUNDED_DIGEST.test(record.recoveryId) || !BOUNDED_DIGEST.test(record.codeDigest) ||
    !DEVICE_ID.test(record.issuerDeviceId) || !validInteger(record.issuedAt) || !validInteger(record.expiresAt) ||
    !["active", "consumed", "cancelled", "replaced", "expired", "issuer-revoked"].includes(record.status) ||
    active !== (record.status === "active")) throw new Error("invalid trusted device registry");
  if (record.endedAt !== undefined && !validInteger(record.endedAt)) throw new Error("invalid trusted device registry");
  if (record.consumedAt !== undefined && !validInteger(record.consumedAt)) throw new Error("invalid trusted device registry");
  if (record.targetDeviceId !== undefined && !DEVICE_ID.test(record.targetDeviceId)) throw new Error("invalid trusted device registry");
  if (record.publicKeyThumbprint !== undefined && !BOUNDED_DIGEST.test(record.publicKeyThumbprint)) throw new Error("invalid trusted device registry");
}

export function generateOwnerRecoveryCode(bytes: Uint8Array = randomBytes(10)): string {
  if (bytes.length !== 10) throw new Error("owner recovery entropy must be 80 bits");
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += RECOVERY_ALPHABET[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  if (encoded.length !== 16) throw new Error("owner recovery encoding failed");
  return `OR-${encoded.slice(0, 4)}-${encoded.slice(4, 8)}-${encoded.slice(8, 12)}-${encoded.slice(12)}`;
}

export function normalizeOwnerRecoveryCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith("OR")) throw new Error("invalid owner recovery code");
  const code = compact.slice(2);
  if (code.length !== 16 || [...code].some(character => !RECOVERY_ALPHABET.includes(character))) throw new Error("invalid owner recovery code");
  return code;
}

export class TrustedDeviceRegistry {
  private readonly path: string;
  private readonly recoverySecret: string;
  private readonly writer: RegistryWriter;

  constructor(path: string, recoverySecret = "", writer: RegistryWriter = atomicWrite) {
    this.path = path;
    this.recoverySecret = recoverySecret;
    this.writer = writer;
  }

  private read(): Registry {
    if (!existsSync(this.path)) return { version: 1, devices: [] };
    const raw = readFileSync(this.path, "utf8");
    if (Buffer.byteLength(raw) > MAX_REGISTRY_BYTES) throw new Error("trusted device registry is too large");
    const registry = JSON.parse(raw) as Registry;
    if (registry?.version !== 1 || !Array.isArray(registry.devices) || registry.devices.length > MAX_DEVICES) throw new Error("invalid trusted device registry");
    const seen = new Set<string>();
    for (const device of registry.devices) {
      if (!device || !DEVICE_ID.test(device.deviceId) || typeof device.label !== "string" || device.label.length > 80 ||
        typeof device.revoked !== "boolean" || seen.has(device.deviceId)) throw new Error("invalid trusted device registry");
      seen.add(device.deviceId);
    }
    if (registry.recovery !== undefined) {
      const state = registry.recovery;
      if (!state || !Array.isArray(state.history) || state.history.length > MAX_HISTORY || !Array.isArray(state.issues) || state.issues.length > MAX_ISSUE_EVENTS ||
        !Array.isArray(state.attempts) || state.attempts.length > GLOBAL_REDEEM_LIMIT) throw new Error("invalid trusted device registry");
      if (state.active) validateRecord(state.active, true);
      for (const record of state.history) validateRecord(record, false);
      if (state.issues.some(event => !event || !DEVICE_ID.test(event.issuerDeviceId) || !validInteger(event.issuedAt))) throw new Error("invalid trusted device registry");
      if (state.attempts.some(event => !event || !BOUNDED_DIGEST.test(event.sourceBucket) || !validInteger(event.attemptedAt))) throw new Error("invalid trusted device registry");
    }
    return registry;
  }

  private locked<T>(change: (registry: Registry) => T): T {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`;
    mkdirSync(lock, { mode: 0o700 });
    try { return change(this.read()); }
    finally { rmdirSync(lock); }
  }

  private save(registry: Registry): void { this.writer(this.path, registry); }

  private digest(code: string): string {
    if (!this.recoverySecret) throw new Error("owner recovery unavailable");
    try { return createHmac("sha256", this.recoverySecret).update(normalizeOwnerRecoveryCode(code)).digest("base64url"); }
    catch (error) {
      if (error instanceof OwnerRecoveryRejectedError) throw error;
      throw new OwnerRecoveryRejectedError();
    }
  }

  private digestMatches(expected: string, code: string): boolean {
    const actual = Buffer.from(this.digest(code), "base64url");
    const stored = Buffer.from(expected, "base64url");
    return actual.length === stored.length && timingSafeEqual(actual, stored);
  }

  list(): Device[] { return this.read().devices; }

  isRevoked(deviceId: string): boolean {
    if (!DEVICE_ID.test(deviceId)) throw new Error("invalid trusted device id");
    return this.read().devices.some(device => device.deviceId === deviceId && device.revoked);
  }

  register(deviceId: string, label: string): Device {
    if (!DEVICE_ID.test(deviceId) || !label.trim() || label.length > 80) throw new Error("invalid trusted device");
    return this.locked(registry => {
      const existing = registry.devices.find(device => device.deviceId === deviceId);
      if (existing?.revoked) throw new Error("trusted device revoked");
      if (existing) return existing;
      if (registry.devices.length >= MAX_DEVICES) throw new Error("trusted device registry full");
      const device = { deviceId, label: label.trim(), revoked: false };
      registry.devices.push(device);
      this.save(registry);
      return device;
    });
  }

  revoke(deviceId: string, now = Math.floor(Date.now() / 1000)): Device {
    if (!DEVICE_ID.test(deviceId)) throw new Error("invalid trusted device id");
    return this.locked(registry => {
      const existing = registry.devices.find(device => device.deviceId === deviceId);
      if (existing?.revoked) return existing;
      if (!existing && registry.devices.length >= MAX_DEVICES) throw new Error("trusted device registry full");
      const revoked = existing ? { ...existing, revoked: true } : { deviceId, label: "旧端末", revoked: true };
      registry.devices = [...registry.devices.filter(device => device.deviceId !== deviceId), revoked];
      const state = registry.recovery;
      if (state?.active?.issuerDeviceId === deviceId) {
        state.history.push({ ...state.active, status: "issuer-revoked", endedAt: now });
        state.history = state.history.slice(-MAX_HISTORY);
        delete state.active;
      }
      this.save(registry);
      return revoked;
    });
  }

  issueRecovery(input: { issuerDeviceId: string; code: string }, now = Math.floor(Date.now() / 1000)): { recoveryId: string; expiresAt: number } {
    const codeDigest = this.digest(input.code);
    if (!DEVICE_ID.test(input.issuerDeviceId) || !validInteger(now)) throw new OwnerRecoveryRejectedError();
    return this.locked(registry => {
      const issuer = registry.devices.find(device => device.deviceId === input.issuerDeviceId);
      if (!issuer || issuer.revoked) throw new OwnerRecoveryRejectedError();
      const state = recoveryState(registry);
      state.issues = state.issues.filter(event => event.issuedAt >= now - ISSUE_WINDOW_SECONDS);
      if (state.issues.filter(event => event.issuerDeviceId === input.issuerDeviceId).length >= ISSUE_LIMIT) throw new OwnerRecoveryRejectedError("owner recovery rate limit");
      if (state.active) {
        state.history.push({ ...state.active, status: state.active.expiresAt < now ? "expired" : "replaced", endedAt: now });
        state.history = state.history.slice(-MAX_HISTORY);
      }
      const recoveryId = randomBytes(32).toString("base64url");
      const expiresAt = now + RECOVERY_TTL_SECONDS;
      state.active = { version: 1, recoveryId, codeDigest, issuerDeviceId: input.issuerDeviceId, issuedAt: now, expiresAt, status: "active" };
      state.issues.push({ issuerDeviceId: input.issuerDeviceId, issuedAt: now });
      state.issues = state.issues.slice(-MAX_ISSUE_EVENTS);
      this.save(registry);
      return { recoveryId, expiresAt };
    });
  }

  cancelRecovery(issuerDeviceId: string, now = Math.floor(Date.now() / 1000)): { cancelled: boolean } {
    if (!DEVICE_ID.test(issuerDeviceId) || !validInteger(now)) throw new OwnerRecoveryRejectedError();
    return this.locked(registry => {
      const state = registry.recovery;
      if (!state?.active) return { cancelled: false };
      if (state.active.issuerDeviceId !== issuerDeviceId) throw new OwnerRecoveryRejectedError();
      state.history.push({ ...state.active, status: "cancelled", endedAt: now });
      state.history = state.history.slice(-MAX_HISTORY);
      delete state.active;
      this.save(registry);
      return { cancelled: true };
    });
  }

  redeemRecovery(input: { code: string; deviceId: string; label: string; publicKeyThumbprint: string; sourceBucket: string }, now = Math.floor(Date.now() / 1000)): Device {
    if (!DEVICE_ID.test(input.deviceId) || !input.label.trim() || input.label.length > 80 || !BOUNDED_DIGEST.test(input.publicKeyThumbprint) ||
      !BOUNDED_DIGEST.test(input.sourceBucket) || !validInteger(now)) throw new OwnerRecoveryRejectedError();
    return this.locked(registry => {
      const state = recoveryState(registry);
      state.attempts = state.attempts.filter(event => event.attemptedAt >= now - REDEEM_WINDOW_SECONDS);
      if (state.attempts.length >= GLOBAL_REDEEM_LIMIT || state.attempts.filter(event => event.sourceBucket === input.sourceBucket).length >= SOURCE_REDEEM_LIMIT) {
        throw new OwnerRecoveryRejectedError("owner recovery rate limit");
      }
      state.attempts.push({ sourceBucket: input.sourceBucket, attemptedAt: now });

      const active = state.active;
      if (active && active.expiresAt < now) {
        state.history.push({ ...active, status: "expired", endedAt: now });
        state.history = state.history.slice(-MAX_HISTORY);
        delete state.active;
        this.save(registry);
        throw new OwnerRecoveryRejectedError();
      }
      const issuer = active && registry.devices.find(device => device.deviceId === active.issuerDeviceId);
      const existing = registry.devices.find(device => device.deviceId === input.deviceId);
      const priorTarget = existing && state.history.find(record => record.status === "consumed" && record.targetDeviceId === input.deviceId && record.publicKeyThumbprint === input.publicKeyThumbprint);
      let accepted = Boolean(active && issuer && !issuer.revoked && active.expiresAt >= now && !existing?.revoked && (!existing || priorTarget));
      if (accepted) {
        accepted = this.digestMatches(active!.codeDigest, input.code);
      }
      if (!accepted) {
        this.save(registry);
        throw new OwnerRecoveryRejectedError();
      }

      const device = existing ?? { deviceId: input.deviceId, label: input.label.trim(), revoked: false };
      if (!existing) {
        if (registry.devices.length >= MAX_DEVICES) throw new Error("trusted device registry full");
        registry.devices.push(device);
      }
      state.history.push({ ...active!, status: "consumed", endedAt: now, consumedAt: now, targetDeviceId: input.deviceId, publicKeyThumbprint: input.publicKeyThumbprint });
      state.history = state.history.slice(-MAX_HISTORY);
      delete state.active;
      this.save(registry);
      return device;
    });
  }
}
