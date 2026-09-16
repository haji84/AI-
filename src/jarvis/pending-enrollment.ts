import { createHash, createPublicKey, randomUUID } from "node:crypto";
import type { JarvisNode } from "./types.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";

type Candidate = { requestId: string; node: JarvisNode; identity: JarvisWorkerIdentity; code: string; expiresAt: number };
export class PendingEnrollment {
  private entries = new Map<string, Candidate>();
  private prune(now: number) { for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id); }
  offer(node: JarvisNode, identity: JarvisWorkerIdentity, now = Date.now()) {
    this.prune(now);
    const key = createPublicKey(identity.publicKeyPem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("P-256 identity required");
    const code = createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex").slice(0, 12).toUpperCase();
    const existing = this.entries.get(node.id);
    if (existing && existing.identity.publicKeyPem !== identity.publicKeyPem) throw new Error("Pending identity cannot change key");
    if (!existing && this.entries.size >= 100) throw new Error("Pending registration capacity reached");
    if (!existing) this.entries.set(node.id, { requestId: randomUUID(), node: structuredClone(node), identity: { ...identity }, code, expiresAt: now + 30 * 60_000 });
    return { code, expiresAt: this.entries.get(node.id)!.expiresAt };
  }
  list(now = Date.now()) {
    this.prune(now);
    return [...this.entries.values()].map(item => ({ id: item.requestId, label: item.node.label, code: item.code, expiresAt: item.expiresAt }));
  }
  selected(ids: string[], now = Date.now()) {
    this.prune(now);
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("Select 1-100 unique pending devices");
    return ids.map(id => { const item = [...this.entries.values()].find(candidate => candidate.requestId === id); if (!item) throw new Error("Pending registration expired; reopen Worker"); return structuredClone(item); });
  }
  complete(id: string) { this.entries.delete(id); }
}
