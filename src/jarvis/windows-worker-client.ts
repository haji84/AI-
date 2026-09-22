import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { canonicalWorkerRequest, type JarvisWorkerSignatureAlgorithm } from "./worker-auth.ts";
import { executeWindowsVerificationTask, type WindowsVerificationResultDetail } from "./windows-verification-worker.ts";
import type { JarvisTask } from "./types.ts";

const NEXT_PATH = "/api/jarvis/worker/next";
const RESULT_PATH = "/api/jarvis/worker/result";
const MAX_RESPONSE_BYTES = 128_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface WindowsWorkerIdentityMaterial {
  nodeId: string;
  privateKeyPem: string;
  algorithm: JarvisWorkerSignatureAlgorithm;
}

export interface WindowsWorkerClientOptions {
  brokerBaseUrl: string;
  identity: WindowsWorkerIdentityMaterial;
  fetchImpl?: typeof fetch;
  runtimePlatform?: NodeJS.Platform;
  execute?: (task: JarvisTask, nodeId: string) => Promise<WindowsVerificationResultDetail>;
  timeoutMs?: number;
}

export type WindowsWorkerRunResult =
  | { status: "idle" }
  | { status: "completed"; taskId: string }
  | { status: "failed"; taskId: string; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBrokerBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("windows_worker_invalid_broker_url");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("windows_worker_invalid_broker_base_path");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("windows_worker_insecure_broker_url");
  }
  return url;
}

function controlledFailure(error: unknown): string {
  if (!(error instanceof Error)) return "windows_worker_execution_failed";
  return /^windows_worker_[a-z0-9_:.-]+$/.test(error.message) ? error.message : "windows_worker_execution_failed";
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("windows_worker_response_too_large");
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("windows_worker_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("windows_worker_invalid_broker_json");
  }
}

export class WindowsVerificationWorkerClient {
  private readonly baseUrl: URL;
  private readonly identity: WindowsWorkerIdentityMaterial;
  private readonly fetchImpl: typeof fetch;
  private readonly runtimePlatform: NodeJS.Platform;
  private readonly execute: (task: JarvisTask, nodeId: string) => Promise<WindowsVerificationResultDetail>;
  private readonly timeoutMs: number;
  private readonly privateKey: ReturnType<typeof createPrivateKey>;

  constructor(options: WindowsWorkerClientOptions) {
    this.baseUrl = validateBrokerBaseUrl(options.brokerBaseUrl);
    if (!SAFE_NODE_ID.test(options.identity.nodeId)) throw new Error("windows_worker_invalid_node_id");
    if (options.identity.privateKeyPem.length === 0 || options.identity.privateKeyPem.length > 32_000) {
      throw new Error("windows_worker_invalid_private_key");
    }
    if (options.identity.algorithm !== "ed25519" && options.identity.algorithm !== "ecdsa-p256-sha256") {
      throw new Error("windows_worker_invalid_signature_algorithm");
    }
    this.identity = { ...options.identity };
    this.privateKey = createPrivateKey(options.identity.privateKeyPem);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.runtimePlatform = options.runtimePlatform ?? process.platform;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000) {
      throw new Error("windows_worker_invalid_timeout");
    }
    this.execute = options.execute ?? ((task, nodeId) => executeWindowsVerificationTask({
      task,
      nodeId,
      runtimePlatform: this.runtimePlatform,
    }));
  }

  async runOnce(): Promise<WindowsWorkerRunResult> {
    const next = await this.postSigned(NEXT_PATH, {});
    if (!next.response.ok) throw new Error(`windows_worker_broker_next_failed:${next.response.status}`);
    if (!isRecord(next.payload) || !("task" in next.payload)) throw new Error("windows_worker_invalid_next_response");
    if (next.payload.task === null) return { status: "idle" };
    if (!isRecord(next.payload.task)) throw new Error("windows_worker_invalid_task_response");

    const task = next.payload.task as unknown as JarvisTask;
    const taskId = typeof task.id === "string" && SAFE_NODE_ID.test(task.id) ? task.id : "invalid-task";
    try {
      const detail = await this.execute(task, this.identity.nodeId);
      const posted = await this.postSigned(RESULT_PATH, { taskId: task.id, ok: true, detail });
      if (!posted.response.ok) throw new Error(`windows_worker_broker_result_failed:${posted.response.status}`);
      return { status: "completed", taskId: task.id };
    } catch (error) {
      const reason = controlledFailure(error);
      const posted = await this.postSigned(RESULT_PATH, {
        taskId,
        ok: false,
        detail: { schema: "jarvis.real-machine-result.v1", reason },
      });
      if (!posted.response.ok) throw new Error(`windows_worker_broker_result_failed:${posted.response.status}`);
      return { status: "failed", taskId, reason };
    }
  }

  private async postSigned(path: string, payload: unknown): Promise<{ response: Response; payload: unknown }> {
    const body = JSON.stringify(payload);
    const unsigned = {
      nodeId: this.identity.nodeId,
      timestamp: new Date().toISOString(),
      nonce: randomBytes(16).toString("hex"),
      method: "POST",
      path,
      bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
    };
    const canonical = canonicalWorkerRequest(unsigned);
    const signature = this.identity.algorithm === "ed25519"
      ? sign(null, Buffer.from(canonical, "utf8"), this.privateKey)
      : sign("sha256", Buffer.from(canonical, "utf8"), this.privateKey);
    const url = new URL(path, this.baseUrl);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Jarvis-Node-Id": unsigned.nodeId,
        "X-Jarvis-Timestamp": unsigned.timestamp,
        "X-Jarvis-Nonce": unsigned.nonce,
        "X-Jarvis-Body-Sha256": unsigned.bodySha256,
        "X-Jarvis-Signature": signature.toString("base64"),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return { response, payload: await readBoundedJson(response) };
  }
}
