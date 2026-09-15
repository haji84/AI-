import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorkerCapability } from "./worker-runtime.ts";

export type MeshMessageKind = "task" | "result";
export interface MeshPeer { id: string; capabilities: WorkerCapability[]; available: boolean; }
export interface MeshPayload { taskId: string; requiredCapability: WorkerCapability; body: string; humanGateRequired?: boolean; humanGateApproved?: boolean; }
export interface MeshEnvelope { version: 1; kind: MeshMessageKind; senderId: string; recipientId: string; nonce: string; issuedAt: number; expiresAt: number; payload: MeshPayload; signature: string; }
export interface MeshTransport { send(envelope: MeshEnvelope): Promise<void>; }

function canonical(envelope: Omit<MeshEnvelope, "signature">): string {
  return JSON.stringify({ version: envelope.version, kind: envelope.kind, senderId: envelope.senderId, recipientId: envelope.recipientId, nonce: envelope.nonce, issuedAt: envelope.issuedAt, expiresAt: envelope.expiresAt, payload: envelope.payload });
}
function sign(unsigned: Omit<MeshEnvelope, "signature">, secret: string): string { return createHmac("sha256", secret).update(canonical(unsigned)).digest("hex"); }
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex"); const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export class LocalDeviceMesh {
  private readonly peerId: string;
  private readonly secret: string;
  private readonly capabilities: Set<WorkerCapability>;
  private readonly transport: MeshTransport;
  private readonly peers = new Map<string, MeshPeer>();
  private readonly seenNonces = new Set<string>();
  private readonly maxTtlMs: number;

  constructor(options: { peerId: string; secret: string; capabilities: WorkerCapability[]; transport: MeshTransport; maxTtlMs?: number }) {
    this.peerId = options.peerId; this.secret = options.secret; this.capabilities = new Set(options.capabilities); this.transport = options.transport; this.maxTtlMs = options.maxTtlMs ?? 60_000;
  }

  registerPeer(peer: MeshPeer): void { this.peers.set(peer.id, { ...peer, capabilities: [...peer.capabilities] }); }
  selectPeer(capability: WorkerCapability): MeshPeer | undefined {
    return [...this.peers.values()].filter((peer) => peer.available && peer.capabilities.includes(capability)).sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  createEnvelope(kind: MeshMessageKind, recipientId: string, payload: MeshPayload, nonce: string, now = Date.now(), ttlMs = 30_000): MeshEnvelope {
    if (ttlMs <= 0 || ttlMs > this.maxTtlMs) throw new Error("mesh ttl outside bounded policy");
    const peer = this.peers.get(recipientId);
    if (!peer) throw new Error("mesh recipient is not registered");
    if (!peer.capabilities.includes(payload.requiredCapability)) throw new Error("mesh recipient lacks required capability");
    if (payload.humanGateRequired && !payload.humanGateApproved) throw new Error("human gate approval required before mesh dispatch");
    const unsigned = { version: 1 as const, kind, senderId: this.peerId, recipientId, nonce, issuedAt: now, expiresAt: now + ttlMs, payload };
    return { ...unsigned, signature: sign(unsigned, this.secret) };
  }

  async dispatch(kind: MeshMessageKind, recipientId: string, payload: MeshPayload, nonce: string, now = Date.now(), ttlMs = 30_000): Promise<MeshEnvelope> {
    const envelope = this.createEnvelope(kind, recipientId, payload, nonce, now, ttlMs);
    await this.transport.send(envelope); return envelope;
  }

  receive(envelope: MeshEnvelope, now = Date.now()): MeshPayload {
    if (envelope.version !== 1) throw new Error("unsupported mesh protocol version");
    if (envelope.recipientId !== this.peerId) throw new Error("mesh envelope addressed to another peer");
    const sender = this.peers.get(envelope.senderId); if (!sender) throw new Error("untrusted mesh sender");
    if (now < envelope.issuedAt || now > envelope.expiresAt || envelope.expiresAt - envelope.issuedAt > this.maxTtlMs) throw new Error("expired or invalid mesh envelope");
    if (this.seenNonces.has(`${envelope.senderId}:${envelope.nonce}`)) throw new Error("mesh replay rejected");
    const { signature, ...unsigned } = envelope;
    if (!sameSignature(signature, sign(unsigned, this.secret))) throw new Error("mesh signature invalid");
    if (!this.capabilities.has(envelope.payload.requiredCapability)) throw new Error("local peer lacks required capability");
    if (envelope.payload.humanGateRequired && !envelope.payload.humanGateApproved) throw new Error("human gate approval missing in mesh envelope");
    this.seenNonces.add(`${envelope.senderId}:${envelope.nonce}`);
    return envelope.payload;
  }
}
