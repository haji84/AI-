import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Invitation = { version: 1; id: string; digest: string; createdAt: string; revoked: boolean; maxDevices: number; used: string[] };
export const INVITATION_PREFIX = "ji_";
export class OwnerInvitationStore {
  constructor(privateFile: string) { this.file = privateFile; }
  private readonly file: string;
  private read(): Invitation | undefined {
    if (!existsSync(this.file)) return undefined;
    const text = readFileSync(this.file, "utf8");
    if (text.length > 32_768) throw new Error("Invitation state too large");
    const item = JSON.parse(text) as Invitation;
    if (item.version !== 1 || !/^[a-f0-9]{64}$/.test(item.digest) || !/^[a-f0-9]{16}$/.test(item.id)
      || typeof item.revoked !== "boolean" || !Number.isInteger(item.maxDevices) || item.maxDevices < 1 || item.maxDevices > 100
      || !Array.isArray(item.used) || item.used.length > item.maxDevices || item.used.some(id => typeof id !== "string" || id.length > 256)) throw new Error("Invalid invitation state");
    return item;
  }
  private save(item: Invitation) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + ".tmp", JSON.stringify(item), { mode: 0o600 });
    renameSync(this.file + ".tmp", this.file);
  }
  status() {
    const item = this.read();
    return item ? { id: item.id, active: !item.revoked && item.used.length < item.maxDevices, createdAt: item.createdAt,
      maxDevices: item.maxDevices, usedDevices: item.used.length, remaining: item.maxDevices - item.used.length, revoked: item.revoked }
      : { active: false, maxDevices: 0, usedDevices: 0, remaining: 0, revoked: false };
  }
  create(maxDevices = 100) {
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100) throw new Error("Invitation limit must be 1..100");
    if (this.status().active) throw new Error("Revoke the existing invitation before issuing another");
    const secret = INVITATION_PREFIX + randomBytes(32).toString("base64url");
    this.save({ version: 1, id: randomBytes(8).toString("hex"), digest: createHash("sha256").update(secret).digest("hex"),
      createdAt: new Date().toISOString(), revoked: false, maxDevices, used: [] });
    return { secret, ...this.status() };
  }
  revoke() { const item = this.read(); if (item) this.save({ ...item, revoked: true }); return this.status(); }
  consume(secret: string, nodeId: string) {
    if (!/^ji_[A-Za-z0-9_-]{43}$/.test(secret) || !nodeId || nodeId.length > 256) throw new Error("Invalid invitation");
    const item = this.read();
    const digest = createHash("sha256").update(secret).digest();
    if (!item || item.revoked || !timingSafeEqual(digest, Buffer.from(item.digest, "hex"))) throw new Error("Invalid invitation");
    if (item.used.includes(nodeId)) throw new Error("Identity already used this invitation");
    if (item.used.length >= item.maxDevices) throw new Error("Invitation capacity reached");
    // Reserve durably before enrollment. A crash can consume a slot, never grant an extra slot.
    this.save({ ...item, used: [...item.used, nodeId] });
  }
}
