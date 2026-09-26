import { createHash, randomBytes } from "node:crypto";

const DEVICE = /^[A-Za-z0-9_-]{16,96}$/;

export function publicKeyThumbprint(jwk: JsonWebKey): string {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("invalid device key");
  return createHash("sha256").update(JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y })).digest("base64url");
}

type Record = {
  contextId: string;
  deviceId: string;
  publicKeyJwk: JsonWebKey;
  publicKeyThumbprint: string;
  state: string;
  nonce: string;
  pkceChallenge: string;
  expiresAt: number;
  consumed: boolean;
};

export class GoogleOwnerEnrollmentStore {
  private records = new Map<string, Record>();

  issue(input: { deviceId: string; publicKeyJwk: JsonWebKey; state: string; nonce: string; pkceChallenge: string }, now = Math.floor(Date.now() / 1000)) {
    if (!DEVICE.test(input.deviceId) || !input.state || !input.nonce || !input.pkceChallenge) throw new Error("invalid enrollment context");
    const contextId = randomBytes(24).toString("base64url");
    const record: Record = { ...input, contextId, publicKeyThumbprint: publicKeyThumbprint(input.publicKeyJwk), expiresAt: now + 300, consumed: false };
    this.records.set(contextId, record);
    return { contextId, expiresAt: record.expiresAt };
  }

  consume(input: { contextId: string; deviceId: string; publicKeyThumbprint: string; state: string; nonce: string }, now = Math.floor(Date.now() / 1000)) {
    const record = this.records.get(input.contextId);
    if (!record || record.consumed || record.expiresAt < now || record.deviceId !== input.deviceId || record.publicKeyThumbprint !== input.publicKeyThumbprint || record.state !== input.state || record.nonce !== input.nonce) throw new Error("enrollment context rejected");
    record.consumed = true;
    return { ...record };
  }
}
