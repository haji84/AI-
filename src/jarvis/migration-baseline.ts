import { createHash, createPublicKey } from "node:crypto";
import type { JarvisControlPlaneSnapshot } from "./control-plane.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/** Metadata-only audit. Never export task payloads, public-key bodies or credentials. */
export function migrationBaseline(snapshot: JarvisControlPlaneSnapshot, identities: JarvisWorkerIdentity[], now = new Date()) {
  const identityIds = identities.map(i => i.nodeId);
  const ids = snapshot.fleet.map(n => n.id);
  if (new Set(ids).size !== ids.length || new Set(identityIds).size !== identityIds.length) throw Error("Duplicate device identity");
  return {
    version: 1 as const, collectedAt: now.toISOString(), snapshotAt: snapshot.generatedAt,
    consistency: "durable-snapshot-only" as const,
    devices: snapshot.fleet.map(n => {
      const identity = identities.find(i => i.nodeId === n.id);
      const publicKeyFingerprint = identity ? createHash("sha256").update(createPublicKey(identity.publicKeyPem)
        .export({ type: "spki", format: "der" })).digest("hex") : null;
      return { id: n.id, platform: n.kind, label: n.label, capabilities: [...n.capabilities].sort(),
        policyDigest: digest(n.policy), metadataDigest: digest({ label: n.label, fleetNumber: n.fleetNumber, group: n.group }),
        protocol: n.telemetry?.remoteProtocol ?? null, workerVersion: n.telemetry?.workerVersion ?? null,
        lastHeartbeat: n.lastSeenAt, status: n.status,
        connectivity: now.getTime() - Date.parse(n.lastSeenAt) <= 90_000 && now.getTime() >= Date.parse(n.lastSeenAt) ? "recent-heartbeat" : "stale-or-invalid",
        enrollment: n.enrollment, credentialExists: Boolean(identity), publicKeyFingerprint,
        algorithm: identity?.algorithm ?? (identity ? "ed25519" : null), enrolledAt: identity?.enrolledAt ?? null,
        revokedAt: identity?.revokedAt ?? null,
        pendingTasks: snapshot.tasks.filter(t => (t.assignedNodeId === n.id || t.targetNodeId === n.id) && ["queued", "leased", "running", "waiting-connectivity", "waiting-human"].includes(t.status)).map(t => t.id).sort(),
        verificationState: "not-physically-reverified" };
    }).sort((a,b) => a.id.localeCompare(b.id)),
    tasks: snapshot.tasks.map(t => ({ id: t.id, status: t.status, assignedNodeId: t.assignedNodeId ?? null,
      targetNodeId: t.targetNodeId ?? null, digest: digest(t) })).sort((a,b) => a.id.localeCompare(b.id)),
    audit: { count: snapshot.audit.length, digest: digest(snapshot.audit) },
    takeovers: { count: snapshot.activeTakeovers.length, digest: digest(snapshot.activeTakeovers) },
    orphanIdentityCount: identities.filter(i => !ids.includes(i.nodeId)).length,
    excluded: ["in-memory pending enrollment", "in-memory nonce registry", "in-memory remote mailbox", "iPhone bridge state", "device-local offline queue", "external evidence files"],
  };
}

export type MigrationBaseline = ReturnType<typeof migrationBaseline>;
/** Compare frozen copies of the SAME cut; never use this to silently roll back live progress. */
export function compareMigrationBaseline(before: MigrationBaseline, candidate: MigrationBaseline): string[] {
  const errors: string[] = [];
  for (const field of ["devices", "tasks", "audit", "takeovers", "orphanIdentityCount"] as const) {
    // Heartbeat/status changes require a new coordinated snapshot, not last-write-wins.
    if (canonical(before[field]) !== canonical(candidate[field])) errors.push(`${field}: snapshot mismatch`);
  }
  return errors;
}
