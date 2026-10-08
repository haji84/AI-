import { createHash, createPublicKey, sign, verify } from "node:crypto";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";
import { canonicalWorkerRequest } from "./worker-auth.ts";
import { privateWorkerHeaders } from "./private-worker-ingress.ts";
import { PC_OBSERVATION_RECEIVE, PC_OBSERVATION_MAX_BYTES } from "./pc-task-observation.ts";

const paths = new Set(["/api/jarvis/worker/heartbeat", "/api/jarvis/worker/pc/next", "/api/jarvis/worker/pc/result", PC_OBSERVATION_RECEIVE]);
const nodes = new Set(["macbook", "zbook"]);
const maxBytes = 1_000_000;
export function privatePcOrigin(value: string, domain: string): string {
  const url = new URL(value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/.test(domain) ||
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.pathname !== "/" || url.search || url.hash ||
    !new RegExp("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\." + domain.replaceAll(".", "\\.") + "$").test(url.hostname)) {
    throw new Error("PC_PRIVATE_ORIGIN_REJECTED");
  }
  return url.origin;
}
async function boundedBytes(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal, limit = maxBytes): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("PC_PRIVATE_BODY_REJECTED");
    for (;;) {
      const chunk = await reader.read();
      if (signal?.aborted) throw new Error("PC_PRIVATE_BODY_REJECTED");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("PC_PRIVATE_BODY_REJECTED");
      parts.push(chunk.value);
    }
    return Buffer.concat(parts);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}
function context(request: Request): string {
  const url = new URL(request.url);
  return canonicalWorkerRequest({ nodeId: request.headers.get("x-jarvis-node-id") || "",
    timestamp: request.headers.get("x-jarvis-timestamp") || "", nonce: request.headers.get("x-jarvis-nonce") || "",
    method: request.method, path: url.pathname, bodySha256: request.headers.get("x-jarvis-body-sha256") || "" });
}
function proof(request: Request, nodeId: string, revision: string, timestamp: string, status: number, digest: string): string {
  return ["GORIQ-PRIVATE-PC-RESPONSE-v1", nodeId, revision, timestamp, context(request), status, digest].join("\n");
}
type Signer = { identity: { nodeId: string; privateKeyPem: string }; revision: string; roles?: string[] };
export function privatePcRelay(options: {
  ingress: (request: Request) => Promise<boolean>; signer: () => Promise<Signer>; upstream?: typeof fetch;
}): (request: Request) => Promise<Response> {
  const upstream = options.upstream ?? fetch;
  let active = 0;
  return async request => {
    const denied = () => Response.json({ message: "private PC route unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.search || !paths.has(url.pathname) ||
      !nodes.has(request.headers.get("x-jarvis-node-id") || "") ||
      !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return denied();
    if (active >= 8) return Response.json({ message: "private PC route busy" }, { status: 503 });
    active++;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try {
      if (await options.ingress(request) !== true) return denied();
      // Prove the existing local signing identity before any lease-changing request.
      const signer = await options.signer();
      if (!nodes.has(signer.identity.nodeId) || !/^[a-f0-9]{40}$/.test(signer.revision)) throw new Error();
      if (url.pathname === PC_OBSERVATION_RECEIVE &&
        (!signer.roles?.includes("Storage") || !signer.roles.includes("Coordinator"))) throw new Error();
      const body = await boundedBytes(request.body, signal, url.pathname === PC_OBSERVATION_RECEIVE ? PC_OBSERVATION_MAX_BYTES : maxBytes);
      const rawHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => { rawHeaders[key] = value; });
      const result = await upstream("http://127.0.0.1:8787" + url.pathname, { method: "POST",
        headers: privateWorkerHeaders(rawHeaders), body: new Uint8Array(body), redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      if (!result.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error();
      const bytes = await boundedBytes(result.body, signal), digest = createHash("sha256").update(bytes).digest("hex");
      const timestamp = new Date().toISOString();
      const signature = sign(null, Buffer.from(proof(request, signer.identity.nodeId, signer.revision, timestamp, result.status, digest)),
        signer.identity.privateKeyPem).toString("base64");
      return new Response(new Uint8Array(bytes), { status: result.status, headers: {
        "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Goriq-Peer-Id": signer.identity.nodeId, "X-Goriq-Peer-Revision": signer.revision,
        "X-Goriq-Peer-Timestamp": timestamp, "X-Goriq-Peer-Body-Sha256": digest, "X-Goriq-Peer-Signature": signature } });
    } catch {
      return Response.json({ message: "private PC transport unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    } finally { active--; }
  };
}
/** TLS remains system-verified by fetch; the enrolled Node key independently pins the peer response. */
export async function verifyPrivatePcResponse(response: Response, input: {
  request: Request; peer: JarvisWorkerIdentity; revision: string; now?: Date;
}): Promise<Response> {
  try {
    const { peer, request, revision } = input;
    const timestamp = response.headers.get("x-goriq-peer-timestamp") || "";
    const digest = response.headers.get("x-goriq-peer-body-sha256") || "";
    const signature = response.headers.get("x-goriq-peer-signature") || "";
    const when = Date.parse(timestamp);
    if (peer.revokedAt || !nodes.has(peer.nodeId) || peer.algorithm !== "ed25519" ||
      !/^[a-f0-9]{40}$/.test(revision) || response.headers.get("x-goriq-peer-id") !== peer.nodeId ||
      response.headers.get("x-goriq-peer-revision") !== revision || !Number.isFinite(when) ||
      Math.abs((input.now ?? new Date()).getTime() - when) > 300_000 ||
      !/^[a-f0-9]{64}$/.test(digest) || !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
      !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error();
    const bytes = await boundedBytes(response.body, AbortSignal.any([input.request.signal, AbortSignal.timeout(30_000)])), key = createPublicKey(peer.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || createHash("sha256").update(bytes).digest("hex") !== digest ||
      !verify(null, Buffer.from(proof(request, peer.nodeId, revision, timestamp, response.status, digest)),
        key, Buffer.from(signature, "base64"))) throw new Error();
    return new Response(new Uint8Array(bytes), { status: response.status, headers: response.headers });
  } catch { throw new Error("PC_PRIVATE_PEER_PROOF_REJECTED"); }
}
