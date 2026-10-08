import { createHash, randomUUID, sign } from "node:crypto";
import { assertPcRuntime, localBrokerOrigin } from "./pc-bootstrap.ts";
import { canonicalWorkerRequest, type JarvisWorkerIdentity } from "./worker-auth.ts";
import type { PcLocalIdentity } from "./pc-local-identity.ts";
import { privatePcOrigin, verifyPrivatePcResponse } from "./private-pc-transport.ts";
import { PC_OBSERVATION_EXPORT, PC_OBSERVATION_RECEIVE, PC_OBSERVATION_MAX_BYTES, validatePcObservation, observationDigest, type PcObservationAck } from "./pc-task-observation.ts";

/** Explicit task only; existing node keys attest observations without importing execution ownership. */
export async function synchronizePcObservation(input: { localBase: string; peerBase: string; tailnetDomain: string;
  revision: string; taskId: string; identity: PcLocalIdentity; peer: JarvisWorkerIdentity;
  localRequest?: typeof fetch; peerRequest?: typeof fetch }): Promise<PcObservationAck> {
  const localBase = localBrokerOrigin(input.localBase), peerBase = privatePcOrigin(input.peerBase, input.tailnetDomain);
  if (!/^pc-[a-f0-9]{64}$/.test(input.taskId) || !["macbook", "zbook"].includes(input.identity.nodeId) ||
    !["macbook", "zbook"].includes(input.peer.nodeId) || input.peer.nodeId === input.identity.nodeId ||
    input.identity.algorithm !== "ed25519" || input.peer.algorithm !== "ed25519" || input.peer.revokedAt) throw Error("PC_OBSERVATION_PEER_REJECTED");
  const localRequest = input.localRequest ?? fetch, peerRequest = input.peerRequest ?? fetch;
  await assertPcRuntime(localBase, input.revision, localRequest);
  const signed = (base: string, path: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > PC_OBSERVATION_MAX_BYTES) throw Error("PC_OBSERVATION_SIZE_REJECTED");
    const unsigned = { nodeId: input.identity.nodeId, path, method: "POST", timestamp: new Date().toISOString(), nonce: randomUUID(),
      bodySha256: createHash("sha256").update(body).digest("hex") };
    return new Request(base + path, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", "X-Jarvis-Node-Id": unsigned.nodeId, "X-Jarvis-Timestamp": unsigned.timestamp,
        "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256,
        "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), input.identity.privateKeyPem).toString("base64") } });
  };
  const exported = await localRequest(signed(localBase, PC_OBSERVATION_EXPORT, { taskId: input.taskId, revision: input.revision }));
  if (!exported.ok) throw Error("PC_OBSERVATION_EXPORT_REJECTED");
  const observation = validatePcObservation(await exported.json());
  if (observation.id !== input.taskId) throw Error("PC_OBSERVATION_TASK_REJECTED");
  const envelope = { taskId: input.taskId, revision: input.revision, sourceNodeId: input.identity.nodeId, observation };
  const ack = async (response: Response): Promise<PcObservationAck> => {
    if (!response.ok) throw Error("PC_OBSERVATION_RECEIVE_REJECTED");
    const result = await response.json() as PcObservationAck;
    if (!result || Object.keys(result).some(key => !["taskId", "observationDigest", "duplicate", "conflicted"].includes(key)) ||
      result.taskId !== input.taskId || result.observationDigest !== observationDigest(observation) ||
      typeof result.duplicate !== "boolean" || typeof result.conflicted !== "boolean") throw Error("PC_OBSERVATION_ACK_REJECTED");
    return result;
  };
  // Local and received observations must coexist, otherwise reciprocal pushes
  // leave each Broker blind to conflicts with its own executable task state.
  const local = await ack(await localRequest(signed(localBase, PC_OBSERVATION_RECEIVE, envelope)));
  const request = signed(peerBase, PC_OBSERVATION_RECEIVE, envelope);
  const response = await verifyPrivatePcResponse(await peerRequest(request.clone()), { request, peer: input.peer, revision: input.revision });
  const result = await ack(response);
  return { ...result, conflicted: local.conflicted || result.conflicted };
}
