import { createHash, randomUUID, sign } from "node:crypto";
import type { PcLocalIdentity } from "./pc-local-identity.ts";
import { canonicalWorkerRequest } from "./worker-auth.ts";

export function localBrokerOrigin(base: string): string {
  const url = new URL(base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) throw new Error("PC_BOOTSTRAP_LOOPBACK_REQUIRED");
  return url.origin;
}
export async function assertPcRuntime(base: string, revision: string, request = fetch): Promise<void> {
  base = localBrokerOrigin(base);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("PC_BOOTSTRAP_REVISION_MISMATCH");
  const response = await request(base + "/health", { signal: AbortSignal.timeout(5000) });
  const health = await response.json();
  if (!response.ok || health.ok !== true || health.runtimeRevision !== revision) throw new Error("PC_BOOTSTRAP_REVISION_MISMATCH");
}
/** Owner token is used only for local enrollment; worker heartbeat uses only its node key. */
export async function registerLocalPc(input: { base: string; revision: string; ownerToken: string;
  identity: PcLocalIdentity; alreadyEnrolled?: boolean; request?: typeof fetch }): Promise<void> {
  const request = input.request ?? fetch, base = localBrokerOrigin(input.base), identity = input.identity;
  await assertPcRuntime(base, input.revision, request);
  if (!input.ownerToken) throw new Error("PC_BOOTSTRAP_OWNER_UNAVAILABLE");
  const post = async (path: string, payload: unknown) => {
    const response = await request(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.ownerToken}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    if (response.status !== 201) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
    return response.json();
  };
  if (!input.alreadyEnrolled) {
    const challenge = await post("/api/jarvis/admin/pc-enrollment/challenge", { nodeId: identity.nodeId, platform: identity.platform, algorithm: identity.algorithm, publicKeyPem: identity.publicKeyPem });
    if (typeof challenge.challengeId !== "string" || challenge.challengeId.length > 100 ||
      typeof challenge.proofText !== "string" || !challenge.proofText.startsWith(`GORIQ-PC-ENROLL-v1\n${challenge.challengeId}\n`) ||
      !/^[a-f0-9]{64}$/.test(challenge.proofText.split("\n")[2] ?? "") || challenge.proofText.split("\n").length !== 3 ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now() || Date.parse(challenge.expiresAt) > Date.now() + 300_000) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
    const result = await post("/api/jarvis/admin/pc-enrollment/prove", { challengeId: challenge.challengeId,
      signatureBase64: sign(null, Buffer.from(challenge.proofText), identity.privateKeyPem).toString("base64") });
    if (result.node?.id !== identity.nodeId || result.node?.kind !== identity.platform) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
  }
  const path = "/api/jarvis/worker/heartbeat", body = JSON.stringify({ status: "ready", capabilities: ["filesystem"] });
  const unsigned = { nodeId: identity.nodeId, path, method: "POST", timestamp: new Date().toISOString(), nonce: randomUUID(), bodySha256: createHash("sha256").update(body).digest("hex") };
  const response = await request(base + path, { method: "POST", body, headers: { "Content-Type": "application/json",
    "X-Jarvis-Node-Id": unsigned.nodeId, "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce,
    "X-Jarvis-Body-Sha256": unsigned.bodySha256, "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), identity.privateKeyPem).toString("base64") }, signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  if (!response.ok || result.node?.id !== identity.nodeId || result.node?.kind !== identity.platform) throw new Error("PC_BOOTSTRAP_HEARTBEAT_REJECTED");
}
