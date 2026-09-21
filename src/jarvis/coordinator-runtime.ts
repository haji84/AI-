import { createHash, randomUUID } from "node:crypto";

export type CoordinatorRoute = "LAN" | "TAILNET" | "OFFLINE";
export type CoordinatorMode = "LEGACY" | "SHADOW" | "CANARY" | "PRIMARY" | "ROLLBACK";
export type ReplicatedState<T> = { version: number; updatedAt: string; checksum: string; value: T };
export type WriterLease = { holder: string; token: string; expiresAt: number };

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class HomeCoordinatorController<T> {
  readonly logicalCoordinatorId: string;
  private mode: CoordinatorMode = "LEGACY";
  private primary?: ReplicatedState<T>;
  private shadow?: ReplicatedState<T>;
  private previous?: ReplicatedState<T>;
  private lease?: WriterLease;
  private canary = new Set<string>();

  constructor(logicalCoordinatorId = "JARVIS-HOME-COORDINATOR") {
    this.logicalCoordinatorId = logicalCoordinatorId;
  }

  currentMode(): CoordinatorMode { return this.mode; }

  seed(value: T, version = 1, now = new Date()): ReplicatedState<T> {
    this.primary = { version, updatedAt: now.toISOString(), checksum: checksum(value), value };
    return this.primary;
  }

  beginShadow(value: T, version: number, now = new Date()) {
    if (!this.primary) throw new Error("primary state is required before shadow");
    this.mode = "SHADOW";
    this.shadow = { version, updatedAt: now.toISOString(), checksum: checksum(value), value };
    return this.compare();
  }

  replicateToShadow(value: T, version: number, now = new Date()) {
    if (!this.primary || this.mode === "LEGACY") throw new Error("shadow migration has not started");
    if (version < this.primary.version) throw new Error("state replication cannot move backwards");
    this.shadow = { version, updatedAt: now.toISOString(), checksum: checksum(value), value };
    return this.compare();
  }

  compare() {
    if (!this.primary || !this.shadow) return { equal: false, reason: "missing-state" as const };
    if (this.primary.version !== this.shadow.version) return { equal: false, reason: "version" as const };
    if (this.primary.checksum !== this.shadow.checksum) return { equal: false, reason: "checksum" as const };
    return { equal: true, reason: "match" as const };
  }

  enableCanary(deviceIds: string[]) {
    if (this.mode !== "SHADOW" && this.mode !== "CANARY") throw new Error("canary requires shadow mode");
    if (!deviceIds.length) throw new Error("at least one canary device is required");
    this.canary = new Set(deviceIds);
    this.mode = "CANARY";
  }

  routeFor(deviceId: string, input: { sameTrustedLan: boolean; tailnetAvailable: boolean; online: boolean }): CoordinatorRoute {
    if (!input.online) return "OFFLINE";
    if (input.sameTrustedLan) return "LAN";
    if (input.tailnetAvailable) return "TAILNET";
    return "OFFLINE";
  }

  routeAllowedForCanary(deviceId: string): boolean {
    return this.mode !== "CANARY" || this.canary.has(deviceId);
  }

  acquireWriter(holder: string, ttlMs = 30_000, now = Date.now()): WriterLease {
    if (!holder) throw new Error("writer holder required");
    if (this.lease && this.lease.expiresAt > now && this.lease.holder !== holder) throw new Error("single-writer lease already held");
    this.lease = { holder, token: randomUUID(), expiresAt: now + Math.max(1_000, ttlMs) };
    return this.lease;
  }

  validateWriter(token: string, now = Date.now()): boolean {
    return Boolean(this.lease && this.lease.token === token && this.lease.expiresAt > now);
  }

  promoteShadow(now = new Date()): ReplicatedState<T> {
    if (!this.shadow || !this.primary) throw new Error("shadow state is missing");
    const compared = this.compare();
    if (!compared.equal) throw new Error("shadow state does not match primary");
    this.previous = this.primary;
    this.primary = { ...this.shadow, updatedAt: now.toISOString() };
    this.mode = "PRIMARY";
    this.shadow = undefined;
    this.canary.clear();
    return this.primary;
  }

  rollback(): ReplicatedState<T> {
    if (!this.previous) throw new Error("no rollback snapshot available");
    const current = this.primary;
    this.primary = this.previous;
    this.previous = current;
    this.mode = "ROLLBACK";
    this.canary.clear();
    this.lease = undefined;
    return this.primary;
  }

  snapshot() {
    return {
      logicalCoordinatorId: this.logicalCoordinatorId,
      mode: this.mode,
      primary: this.primary,
      shadow: this.shadow,
      previous: this.previous,
      canary: [...this.canary],
      writer: this.lease ? { holder: this.lease.holder, expiresAt: this.lease.expiresAt } : undefined,
    };
  }
}
