import { createHash, createPublicKey, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  JarvisControlPlane,
  JarvisNonceRegistry,
  JarvisSqliteStateStore,
  verifyWorkerRequest,
  type JarvisNode,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/index.ts";

const host = process.env.JARVIS_BROKER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.JARVIS_BROKER_PORT || 8787);
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const publicBrokerUrl = process.env.JARVIS_PUBLIC_BROKER_URL?.trim().replace(/\/$/, "") || "";

if (!ownerToken) throw new Error("JARVIS_OWNER_TOKEN is required");
if (host !== "127.0.0.1" && host !== "::1" && process.env.JARVIS_ALLOW_NON_LOOPBACK !== "1") {
  throw new Error("Refusing non-loopback broker bind unless JARVIS_ALLOW_NON_LOOPBACK=1. Put TLS/authenticated ingress in front of JARVIS Broker.");
}

const plane = new JarvisControlPlane();
const store = new JarvisSqliteStateStore(process.env.JARVIS_DB_PATH?.trim() || undefined);
const persisted = store.load();
if (persisted) plane.restore(persisted);
const nonces = new JarvisNonceRegistry();
let lastHeartbeatPersist = 0;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  const value = JSON.parse(body.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}

function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireOwner(request: IncomingMessage): boolean {
  const auth = request.headers.authorization || "";
  return auth.startsWith("Bearer ") && safeEqualText(auth.slice(7), ownerToken);
}

function bodySha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function signedWorkerRequest(request: IncomingMessage, path: string, body: Buffer): JarvisSignedWorkerRequest | undefined {
  const nodeId = request.headers["x-jarvis-node-id"];
  const timestamp = request.headers["x-jarvis-timestamp"];
  const nonce = request.headers["x-jarvis-nonce"];
  const declaredBodySha = request.headers["x-jarvis-body-sha256"];
  const signatureBase64 = request.headers["x-jarvis-signature"];
  if (![nodeId, timestamp, nonce, declaredBodySha, signatureBase64].every((value) => typeof value === "string")) return undefined;
  if (!safeEqualText(declaredBodySha as string, bodySha256(body))) return undefined;
  return {
    nodeId: nodeId as string,
    timestamp: timestamp as string,
    nonce: nonce as string,
    method: request.method || "POST",
    path,
    bodySha256: declaredBodySha as string,
    signatureBase64: signatureBase64 as string,
  };
}

function authenticateWorker(request: IncomingMessage, path: string, body: Buffer): JarvisWorkerIdentity | undefined {
  const signed = signedWorkerRequest(request, path, body);
  if (!signed) return undefined;
  const identity = store.getWorkerIdentity(signed.nodeId);
  if (!identity) return undefined;
  const checked = verifyWorkerRequest({
    identity,
    request: signed,
    seenNonce: (nodeId, nonce) => nonces.has(nodeId, nonce),
  });
  if (!checked.ok) return undefined;
  nonces.record(signed.nodeId, signed.nonce);
  return identity;
}

function persist(immediate = true): void {
  const now = Date.now();
  if (!immediate && now - lastHeartbeatPersist < 5_000) return;
  store.save(plane.snapshot());
  lastHeartbeatPersist = now;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validatedNode(value: unknown): JarvisNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("node object required");
  const node = value as JarvisNode;
  if (!node.id || node.kind !== "android" || !Array.isArray(node.capabilities)) throw new Error("invalid Android node descriptor");
  if (node.policy?.allowPaidServices !== false) throw new Error("worker must disable paid services");
  return node;
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", "http://localhost");
  const path = url.pathname;
  const method = request.method || "GET";
  const body = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(request);

  if (method === "GET" && path === "/health") {
    return json(response, 200, { ok: true, service: "jarvis-broker", stats: plane.snapshot().stats });
  }

  if (path.startsWith("/api/jarvis/admin/")) {
    if (!requireOwner(request)) return json(response, 401, { message: "owner authorization required" });
    const payload = parseJson(body);

    if (method === "GET" && path === "/api/jarvis/admin/state") return json(response, 200, plane.snapshot());

    if (method === "POST" && path === "/api/jarvis/admin/enrollment") {
      const mode = payload.mode === "full" || payload.mode === "fleet" ? payload.mode : "quick";
      const token = plane.createEnrollment({
        mode,
        ttlMs: Math.min(Math.max(asNumber(payload.ttlMs, 5 * 60_000), 60_000), 60 * 60_000),
        maxDevices: Math.min(Math.max(asNumber(payload.maxDevices, mode === "fleet" ? 100 : 1), 1), 100),
        group: typeof payload.group === "string" ? payload.group : undefined,
      });
      const deepLink = publicBrokerUrl
        ? `jarvis://enroll?broker=${encodeURIComponent(publicBrokerUrl)}&token=${encodeURIComponent(token.token)}`
        : undefined;
      return json(response, 201, { token, deepLink });
    }

    if (method === "POST" && path === "/api/jarvis/admin/tasks") {
      if (payload.type !== "open-url") return json(response, 400, { message: "only open-url is enabled in Android Worker v0.1" });
      const taskPayload = payload.payload as Record<string, unknown> | undefined;
      const targetUrl = typeof taskPayload?.url === "string" ? taskPayload.url : "";
      if (!targetUrl.startsWith("https://")) return json(response, 400, { message: "open-url requires HTTPS" });
      const task = plane.enqueueTask({
        idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : `open-url:${createHash("sha256").update(targetUrl).digest("hex")}`,
        type: "open-url",
        payload: { url: targetUrl, allowJavaScript: taskPayload?.allowJavaScript === true },
        requiredCapabilities: ["open-url"],
        preferredKinds: ["android"],
        priority: payload.priority === "urgent" || payload.priority === "high" || payload.priority === "low" || payload.priority === "background" ? payload.priority : "normal",
        requiresOnline: true,
        targetNodeId: typeof payload.targetNodeId === "string" ? payload.targetNodeId : undefined,
        maxAttempts: Math.min(Math.max(asNumber(payload.maxAttempts, 3), 1), 10),
      });
      persist();
      return json(response, 201, { task });
    }

    if (method === "POST" && path === "/api/jarvis/admin/takeover/resolve") {
      if (typeof payload.sessionId !== "string") return json(response, 400, { message: "sessionId required" });
      const session = plane.resolveTakeover(payload.sessionId, payload.resumeTask !== false);
      persist();
      return json(response, 200, { session });
    }

    return json(response, 404, { message: "unknown admin route" });
  }

  if (method === "POST" && path === "/api/jarvis/enroll") {
    const payload = parseJson(body);
    if (typeof payload.token !== "string") return json(response, 400, { message: "enrollment token required" });
    const node = validatedNode(payload.node);
    const identityInput = payload.identity as Record<string, unknown> | undefined;
    if (!identityInput || typeof identityInput.publicKeyPem !== "string") return json(response, 400, { message: "worker public identity required" });
    const algorithm = identityInput.algorithm === "ed25519" ? "ed25519" : identityInput.algorithm === "ecdsa-p256-sha256" ? "ecdsa-p256-sha256" : undefined;
    if (!algorithm) return json(response, 400, { message: "unsupported worker signature algorithm" });
    const key = createPublicKey(identityInput.publicKeyPem);
    if (algorithm === "ecdsa-p256-sha256" && key.asymmetricKeyType !== "ec") return json(response, 400, { message: "ECDSA worker must provide EC public key" });
    if (algorithm === "ed25519" && key.asymmetricKeyType !== "ed25519") return json(response, 400, { message: "Ed25519 worker must provide Ed25519 public key" });
    const enrolled = plane.enroll(payload.token, node);
    const identity: JarvisWorkerIdentity = {
      nodeId: enrolled.id,
      publicKeyPem: identityInput.publicKeyPem,
      algorithm,
      enrolledAt: new Date().toISOString(),
    };
    store.saveWorkerIdentity(identity);
    persist();
    return json(response, 201, { node: enrolled });
  }

  if (path.startsWith("/api/jarvis/worker/")) {
    const identity = authenticateWorker(request, path, body);
    if (!identity) return json(response, 401, { message: "valid signed worker request required" });
    const payload = parseJson(body);

    if (method === "POST" && path === "/api/jarvis/worker/heartbeat") {
      const telemetry = payload.telemetry && typeof payload.telemetry === "object" && !Array.isArray(payload.telemetry)
        ? payload.telemetry as JarvisNode["telemetry"]
        : undefined;
      const status = payload.status === "busy" || payload.status === "locked" || payload.status === "needs-human" ? payload.status : "ready";
      const node = plane.heartbeat(identity.nodeId, { status, telemetry });
      persist(false);
      return json(response, 200, { node });
    }

    if (method === "POST" && path === "/api/jarvis/worker/next") {
      let assigned = plane.queue.assignedTo(identity.nodeId)[0];
      if (!assigned) {
        plane.dispatch({ mobileOnline: true, pcOnline: true, sameLanAvailable: false });
        assigned = plane.queue.assignedTo(identity.nodeId)[0];
      }
      if (assigned?.status === "leased") assigned = plane.markRunning(assigned.id, identity.nodeId);
      if (assigned) persist();
      return json(response, 200, { task: assigned ?? null });
    }

    if (method === "POST" && path === "/api/jarvis/worker/result") {
      if (typeof payload.taskId !== "string" || typeof payload.ok !== "boolean") return json(response, 400, { message: "taskId and ok required" });
      const detail = payload.detail && typeof payload.detail === "object" && !Array.isArray(payload.detail) ? payload.detail as Record<string, unknown> : {};
      const task = payload.ok
        ? plane.completeTask(payload.taskId, identity.nodeId, detail)
        : plane.failTask(payload.taskId, identity.nodeId, typeof detail.error === "string" ? detail.error : "worker reported failure");
      persist();
      return json(response, 200, { task });
    }

    return json(response, 404, { message: "unknown worker route" });
  }

  return json(response, 404, { message: "not found" });
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    console.error("[jarvis-broker] request failed", error);
    json(response, 500, { message: error instanceof Error ? error.message : "internal error" });
  });
});

server.listen(port, host, () => {
  console.log(`[jarvis-broker] listening on http://${host}:${port}`);
  console.log(`[jarvis-broker] nodes=${plane.snapshot().stats.registered} tasks=${plane.snapshot().tasks.length}`);
});

function shutdown(): void {
  server.close(() => {
    persist();
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
