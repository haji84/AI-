import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PcLocalIdentity } from "./pc-local-identity.ts";
import type { JarvisNode } from "./types.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";
import { assertPcRuntime, localBrokerOrigin } from "./pc-bootstrap.ts";

export interface PublicPcDescriptor {
  version: 1; issue: 1662; goalIssue: 1219; sourceRevision: string;
  nodeId: "macbook" | "zbook"; platform: "macos" | "windows"; algorithm: "ed25519";
  publicKeyPem: string; fingerprint: string; observedAt: string; signatureBase64: string;
}
export interface PeerPcEnvelope {
  version: 1; sourceRevision: string; mode: "challenge" | "already-enrolled";
  coordinator: PublicPcDescriptor; target: PublicPcDescriptor;
  challengeId: string; proofText: string; expiresAt: string;
  candidateContext: { node: JarvisNode; identity: JarvisWorkerIdentity } | null; signatureBase64: string;
}
export interface PeerPcProof {
  version: 1; sourceRevision: string; nodeId: string; challengeSha256: string;
  signatureBase64: string; contextSignatureBase64: string;
}
const ids = ["macbook", "zbook"];
const descriptorKeys = ["version","issue","goalIssue","sourceRevision","nodeId","platform","algorithm","publicKeyPem","fingerprint","observedAt","signatureBase64"];
const envelopeKeys = ["version","sourceRevision","mode","coordinator","target","challengeId","proofText","expiresAt","candidateContext","signatureBase64"];
const proofKeys = ["version","sourceRevision","nodeId","challengeSha256","signatureBase64","contextSignatureBase64"];
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const signatureShape = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9+/]{86}==$/.test(value);
function shape(value: unknown, keys: string[], limit = 16384): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    Object.keys(value).some(k => !keys.includes(k)) || Buffer.byteLength(JSON.stringify(value)) > limit) throw new Error();
}
function descriptorText(value: PublicPcDescriptor): string {
  return "GORIQ-PC-PEER-DESCRIPTOR-v1\n" + JSON.stringify(Object.fromEntries(
    descriptorKeys.filter(k => k !== "signatureBase64").map(k => [k, Reflect.get(value, k)])));
}
function envelopeText(value: PeerPcEnvelope): string {
  return "GORIQ-PC-PEER-CHALLENGE-v1\n" + JSON.stringify(Object.fromEntries(
    envelopeKeys.filter(k => k !== "signatureBase64").map(k => [k, Reflect.get(value, k)])));
}
function envelopeDigest(value: PeerPcEnvelope): string { return digest(envelopeText(value) + "\n" + value.signatureBase64); }
function proofText(value: PeerPcProof): string {
  return ["GORIQ-PC-PEER-PROOF-v1",value.sourceRevision,value.nodeId,value.challengeSha256,value.signatureBase64].join("\n");
}
export function pcPublicFingerprint(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || key.export({ type: "spki", format: "pem" }) !== publicKeyPem) throw new Error("PC_PEER_PUBLIC_KEY_REJECTED");
  return digest(key.export({ type: "spki", format: "der" }));
}
export function publicPcDescriptor(identity: PcLocalIdentity, revision: string, now = new Date()): PublicPcDescriptor {
  try {
    if (identity.version !== 1 || !ids.includes(identity.nodeId) || identity.algorithm !== "ed25519" ||
      identity.platform !== (identity.nodeId === "macbook" ? "macos" : "windows") || !/^[a-f0-9]{40}$/.test(revision)) throw new Error();
    const key = createPrivateKey(identity.privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || createPublicKey(key).export({ type: "spki", format: "pem" }) !== identity.publicKeyPem) throw new Error();
    const value = { version: 1 as const, issue: 1662 as const, goalIssue: 1219 as const, sourceRevision: revision,
      nodeId: identity.nodeId as PublicPcDescriptor["nodeId"], platform: identity.platform as PublicPcDescriptor["platform"],
      algorithm: "ed25519" as const, publicKeyPem: identity.publicKeyPem, fingerprint: pcPublicFingerprint(identity.publicKeyPem),
      observedAt: now.toISOString(), signatureBase64: "" };
    value.signatureBase64 = sign(null, Buffer.from(descriptorText(value)), key).toString("base64"); return value;
  } catch { throw new Error("PC_PEER_DESCRIPTOR_REJECTED"); }
}
/** Caller must supply the fingerprint from independently approved native Evidence. */
export function validatePublicPcDescriptor(value: unknown, input: {
  nodeId: string; revision: string; fingerprint: string; now?: Date;
}): PublicPcDescriptor {
  try {
    shape(value, descriptorKeys, 4096); const d = value as PublicPcDescriptor;
    const when = Date.parse(d.observedAt), now = (input.now ?? new Date()).getTime();
    if (d.version !== 1 || d.issue !== 1662 || d.goalIssue !== 1219 || !ids.includes(d.nodeId) || d.nodeId !== input.nodeId ||
      d.platform !== (d.nodeId === "macbook" ? "macos" : "windows") || d.algorithm !== "ed25519" ||
      !/^[a-f0-9]{40}$/.test(input.revision) || d.sourceRevision !== input.revision ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint) || d.fingerprint !== input.fingerprint ||
      typeof d.publicKeyPem !== "string" || pcPublicFingerprint(d.publicKeyPem) !== input.fingerprint ||
      !Number.isFinite(when) || when > now + 30000 || when < now - 900000 || !signatureShape(d.signatureBase64) ||
      !verify(null, Buffer.from(descriptorText(d)), d.publicKeyPem, Buffer.from(d.signatureBase64,"base64"))) throw new Error();
    return structuredClone(d);
  } catch { throw new Error("PC_PEER_DESCRIPTOR_REJECTED"); }
}
export function assertExistingPcPeer(peer: PublicPcDescriptor, node: JarvisNode | undefined,
  identity: JarvisWorkerIdentity | undefined): void {
  if (!node || !identity || identity.revokedAt || identity.algorithm !== "ed25519" || node.id !== peer.nodeId ||
    identity.nodeId !== peer.nodeId || node.kind !== peer.platform || pcPublicFingerprint(identity.publicKeyPem) !== peer.fingerprint ||
    node.pcAuthority?.version !== 1 || node.pcAuthority.approvalIssue !== 1662 || node.pcAuthority.goalIssue !== 1219 ||
    node.pcAuthority.roles.length !== 4 || new Set(node.pcAuthority.roles).size !== 4 ||
    node.pcAuthority.roles.some(r => !["Executor","Storage","Verifier","Coordinator"].includes(r)) ||
    node.pcAuthority.capabilityCeiling.length !== 1 || node.pcAuthority.capabilityCeiling[0] !== "filesystem") throw new Error("PC_PEER_EXISTING_CONFLICT");
}
async function localPost(base: string, path: string, ownerToken: string, payload: unknown, request: typeof fetch) {
  if (!ownerToken) throw new Error("PC_PEER_OWNER_REQUIRED");
  const response = await request(base + path, { method: "POST", redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + ownerToken },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  if (response.status !== 201) throw new Error("PC_PEER_LOCAL_ENROLLMENT_REJECTED");
  // Enrollment responses are small and remain local; never include them in raw logs.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("PC_PEER_LOCAL_ENROLLMENT_REJECTED");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new Error("PC_PEER_LOCAL_ENROLLMENT_REJECTED"); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function validateCandidateContext(e: PeerPcEnvelope, now: Date): void {
  if (e.mode === "already-enrolled") {
    if (e.candidateContext !== null) throw new Error();
    return;
  }
  const c = e.candidateContext;
  shape(c, ["node","identity"]);
  if (!c || !c.node || !c.identity) throw new Error();
  const date = c.identity.enrolledAt, when = Date.parse(date), roles = c.node.pcAuthority?.roles;
  if (!Number.isFinite(when) || new Date(when).toISOString() !== date ||
    when > now.getTime() + 30000 || when < now.getTime() - 300000 ||
    !Array.isArray(roles) || roles.length !== 4 || new Set(roles).size !== 4 ||
    roles.some(r => !["Executor","Storage","Verifier","Coordinator"].includes(r))) throw new Error();
  const expected = {
    node: {
      id: e.target.nodeId, label: e.target.nodeId, kind: e.target.platform, status: "offline",
      capabilities: ["filesystem"], enrollment: "quick", lastSeenAt: date, telemetry: { checkedAt: date },
      policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false,
        allowRemoteControl: false, requireHumanForLockedDevice: true },
      pcAuthority: { version: 1, approvalIssue: 1662, goalIssue: 1219, roles, capabilityCeiling: ["filesystem"] },
    },
    identity: { nodeId: e.target.nodeId, publicKeyPem: e.target.publicKeyPem, algorithm: "ed25519", enrolledAt: date },
  };
  if (!isDeepStrictEqual(c,expected) || digest(JSON.stringify(c)) !== e.proofText.split("\n")[2]) throw new Error();
}
function validateEnvelope(value: unknown, revision: string, coordinatorFingerprint: string,
  targetFingerprint: string, now = new Date()): PeerPcEnvelope {
  try {
    shape(value, envelopeKeys); const e = value as PeerPcEnvelope;
    if (e.version !== 1 || e.sourceRevision !== revision || !["challenge","already-enrolled"].includes(e.mode) ||
      e.coordinator.nodeId === e.target.nodeId) throw new Error();
    validatePublicPcDescriptor(e.coordinator, { nodeId: e.coordinator.nodeId, revision, fingerprint: coordinatorFingerprint, now });
    validatePublicPcDescriptor(e.target, { nodeId: e.target.nodeId, revision, fingerprint: targetFingerprint, now });
    const expires = Date.parse(e.expiresAt);
    if (!Number.isFinite(expires) || expires <= now.getTime() || expires > now.getTime() + 300000 ||
      !signatureShape(e.signatureBase64) || !verify(null, Buffer.from(envelopeText(e)), e.coordinator.publicKeyPem,
        Buffer.from(e.signatureBase64,"base64"))) throw new Error();
    if (e.mode === "challenge" ? !/^[a-f0-9-]{36}$/.test(e.challengeId) ||
      !new RegExp("^GORIQ-PC-ENROLL-v1\\n" + e.challengeId + "\\n[a-f0-9]{64}$").test(e.proofText) :
      e.challengeId !== "" || e.proofText !== "") throw new Error();
    validateCandidateContext(e, now);
    return structuredClone(e);
  } catch { throw new Error("PC_PEER_CHALLENGE_REJECTED"); }
}
export async function requestPeerPcEnrollment(input: { base: string; revision: string; ownerToken: string;
  identity: PcLocalIdentity; peer: unknown; expectedPeerFingerprint: string; request?: typeof fetch;
  existing?: { node: JarvisNode; identity: JarvisWorkerIdentity }; now?: Date }): Promise<PeerPcEnvelope> {
  const base = localBrokerOrigin(input.base), now = input.now ?? new Date(), request = input.request ?? fetch;
  const coordinator = publicPcDescriptor(input.identity, input.revision, now);
  const target = validatePublicPcDescriptor(input.peer, { nodeId: coordinator.nodeId === "macbook" ? "zbook" : "macbook",
    revision: input.revision, fingerprint: input.expectedPeerFingerprint, now });
  if (input.existing) assertExistingPcPeer(target, input.existing.node, input.existing.identity);
  await assertPcRuntime(base, input.revision, request);
  const challenge = input.existing ? { challengeId: "", proofText: "", expiresAt: new Date(now.getTime() + 240000).toISOString(), candidateContext: null } :
    await localPost(base, "/api/jarvis/admin/pc-enrollment/challenge", input.ownerToken,
      { nodeId: target.nodeId, platform: target.platform, algorithm: target.algorithm, publicKeyPem: target.publicKeyPem }, request);
  const envelope: PeerPcEnvelope = { version: 1, sourceRevision: input.revision,
    mode: input.existing ? "already-enrolled" : "challenge", coordinator, target,
    challengeId: challenge.challengeId, proofText: challenge.proofText, expiresAt: challenge.expiresAt,
    candidateContext: challenge.candidateContext, signatureBase64: "" };
  envelope.signatureBase64 = sign(null, Buffer.from(envelopeText(envelope)), input.identity.privateKeyPem).toString("base64");
  return validateEnvelope(envelope, input.revision, coordinator.fingerprint, target.fingerprint, input.now ?? new Date());
}
export function signPeerPcEnrollment(input: { envelope: unknown; identity: PcLocalIdentity; revision: string;
  expectedCoordinatorFingerprint: string; now?: Date }): PeerPcProof {
  const own = publicPcDescriptor(input.identity, input.revision, input.now);
  const envelope = validateEnvelope(input.envelope, input.revision, input.expectedCoordinatorFingerprint, own.fingerprint, input.now);
  if (envelope.target.nodeId !== own.nodeId) throw new Error("PC_PEER_CHALLENGE_REJECTED");
  const text = envelope.mode === "challenge" ? envelope.proofText : "GORIQ-PC-PEER-ALREADY-v1\n" + envelopeDigest(envelope);
  const value = { version: 1 as const, sourceRevision: input.revision, nodeId: own.nodeId, challengeSha256: envelopeDigest(envelope),
    signatureBase64: sign(null, Buffer.from(text), input.identity.privateKeyPem).toString("base64"), contextSignatureBase64: "" };
  value.contextSignatureBase64 = sign(null, Buffer.from(proofText(value)), input.identity.privateKeyPem).toString("base64"); return value;
}
export async function completePeerPcEnrollment(input: { base: string; revision: string; ownerToken: string;
  identity: PcLocalIdentity; peer: unknown; expectedPeerFingerprint: string; envelope: unknown; proof: unknown;
  request?: typeof fetch; now?: Date }): Promise<{ nodeId: string; fingerprint: string; alreadyEnrolled: boolean }> {
  try {
    const base = localBrokerOrigin(input.base), own = publicPcDescriptor(input.identity, input.revision, input.now);
    const target = validatePublicPcDescriptor(input.peer, { nodeId: own.nodeId === "macbook" ? "zbook" : "macbook",
      revision: input.revision, fingerprint: input.expectedPeerFingerprint, now: input.now });
    const envelope = validateEnvelope(input.envelope, input.revision, own.fingerprint, target.fingerprint, input.now);
    shape(input.proof, proofKeys); const proof = input.proof as PeerPcProof;
    const text = envelope.mode === "challenge" ? envelope.proofText : "GORIQ-PC-PEER-ALREADY-v1\n" + envelopeDigest(envelope);
    if (envelope.coordinator.nodeId !== own.nodeId || envelope.target.nodeId !== target.nodeId ||
      proof.version !== 1 || proof.nodeId !== target.nodeId || proof.sourceRevision !== input.revision ||
      proof.challengeSha256 !== envelopeDigest(envelope) || !signatureShape(proof.signatureBase64) ||
      !signatureShape(proof.contextSignatureBase64) || !verify(null, Buffer.from(text), target.publicKeyPem, Buffer.from(proof.signatureBase64,"base64")) ||
      !verify(null, Buffer.from(proofText(proof)), target.publicKeyPem, Buffer.from(proof.contextSignatureBase64,"base64"))) throw new Error();
    const request = input.request ?? fetch; await assertPcRuntime(base, input.revision, request);
    if (envelope.mode === "challenge") {
      const result = await localPost(base, "/api/jarvis/admin/pc-enrollment/prove", input.ownerToken,
        { challengeId: envelope.challengeId, signatureBase64: proof.signatureBase64 }, request);
      const node = result.node as JarvisNode;
      assertExistingPcPeer(target, node, { nodeId: target.nodeId, algorithm: "ed25519", publicKeyPem: target.publicKeyPem, enrolledAt: "" });
    }
    return { nodeId: target.nodeId, fingerprint: target.fingerprint, alreadyEnrolled: envelope.mode === "already-enrolled" };
  } catch { throw new Error("PC_PEER_PROOF_REJECTED"); }
}
