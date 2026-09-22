import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { canonicalWorkerRequest, type JarvisWorkerSignatureAlgorithm } from "./worker-auth.ts";
import { executeWindowsVerificationTask, validateWindowsVerificationTask, type WindowsVerificationResultDetail } from "./windows-verification-worker.ts";
import { WindowsWorkerJournal, validWindowsReport, isDefinitiveWindowsRejection, type WindowsWorkerReceipt, type WindowsWorkerReport } from "./windows-worker-journal.ts";
import type { JarvisTask } from "./types.ts";
const HEARTBEAT_PATH = "/api/jarvis/worker/heartbeat";
const NEXT_PATH = "/api/jarvis/worker/next";
const RESULT_PATH = "/api/jarvis/worker/result";
const MAX_RESPONSE_BYTES = 128000;
const REQUEST_TIMEOUT_MS = 10000;
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
    journalPath?: string;
}
export type WindowsWorkerRunResult = {
    status: "idle";
} | {
    status: "completed";
    taskId: string;
} | {
    status: "failed";
    taskId: string;
    reason: string;
};
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateBrokerBaseUrl(raw: string): URL {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash)
        throw new Error("windows_worker_invalid_broker_url");
    if (url.pathname !== "/" && url.pathname !== "")
        throw new Error("windows_worker_invalid_broker_base_path");
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error("windows_worker_insecure_broker_url");
    }
    return url;
}
function controlledFailure(error: unknown): string {
    if (!(error instanceof Error))
        return "windows_worker_execution_failed";
    return /^windows_worker_[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "windows_worker_execution_failed";
}
async function readBoundedJson(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        void response.body?.cancel().catch(() => { });
        throw new Error("windows_worker_response_too_large");
    }
    if (!response.body)
        return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
    if (!text)
        return null;
    try {
        return JSON.parse(text) as unknown;
    }
    catch {
        throw new Error("windows_worker_invalid_broker_json");
    }
}
export class WindowsVerificationWorkerClient {
    private readonly journal: WindowsWorkerJournal;
    private readonly binding: string;
    private running = false;
    private readonly baseUrl: URL;
    private readonly identity: WindowsWorkerIdentityMaterial;
    private readonly fetchImpl: typeof fetch;
    private readonly runtimePlatform: NodeJS.Platform;
    private readonly execute: (task: JarvisTask, nodeId: string) => Promise<WindowsVerificationResultDetail>;
    private readonly timeoutMs: number;
    private readonly privateKey: ReturnType<typeof createPrivateKey>;
    constructor(options: WindowsWorkerClientOptions) {
        this.baseUrl = validateBrokerBaseUrl(options.brokerBaseUrl);
        if (!SAFE_NODE_ID.test(options.identity.nodeId))
            throw new Error("windows_worker_invalid_node_id");
        if (options.identity.privateKeyPem.length === 0 || options.identity.privateKeyPem.length > 32000) {
            throw new Error("windows_worker_invalid_private_key");
        }
        if (options.identity.algorithm !== "ed25519" && options.identity.algorithm !== "ecdsa-p256-sha256") {
            throw new Error("windows_worker_invalid_signature_algorithm");
        }
        this.identity = { ...options.identity };
        this.privateKey = createPrivateKey(options.identity.privateKeyPem);
        const keyType = this.privateKey.asymmetricKeyType;
        if (options.identity.algorithm === "ed25519" ? keyType !== "ed25519" : keyType !== "ec" || this.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1")
            throw new Error("windows_worker_key_algorithm_mismatch");
        this.binding = createHash("sha256").update(this.baseUrl.origin + "\n" + this.identity.nodeId + "\n").update(createPublicKey(this.privateKey).export({ type: "spki", format: "der" })).digest("hex");
        this.journal = new WindowsWorkerJournal(this.binding, options.journalPath);
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.runtimePlatform = options.runtimePlatform ?? process.platform;
        this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) {
            throw new Error("windows_worker_invalid_timeout");
        }
        this.execute = options.execute ?? ((task, nodeId) => executeWindowsVerificationTask({
            task,
            nodeId,
            runtimePlatform: this.runtimePlatform,
        }));
    }
    async runOnce(): Promise<WindowsWorkerRunResult> {
        if (this.running)
            throw new Error("windows_worker_already_running");
        this.running = true;
        try {
            return await this.runExclusive();
        }
        finally {
            this.running = false;
        }
    }
    private async deliver(receipt: WindowsWorkerReceipt): Promise<WindowsWorkerRunResult> {
        const report = receipt.report;
        if (!validWindowsReport(report))
            throw new Error("windows_worker_invalid_report");
        const posted = await this.postSigned(RESULT_PATH, report);
        if (!posted.response.ok) {
            const rejection = isRecord(posted.payload) ? posted.payload : undefined;
            const terminal = rejection && isRecord(rejection.task) ? rejection.task : undefined;
            if (posted.response.status === 409 && rejection && isDefinitiveWindowsRejection(rejection.code) && terminal?.id === report.taskId && ["completed", "failed", "cancelled"].includes(String(terminal.status))) {
                // Keep the original execution evidence; this is a rejected delivery, never a verified success.
                this.journal.save({ ...receipt, phase: "rejected", rejectionCode: rejection.code });
                return { status: "failed", taskId: report.taskId, reason: "windows_worker_result_rejected" };
            }
            throw new Error("windows_worker_broker_result_failed");
        }
        const ack = isRecord(posted.payload) ? posted.payload.task : undefined;
        if (!isRecord(ack) || ack.id !== report.taskId || ack.status !== (report.ok ? "completed" : "failed"))
            throw new Error("windows_worker_invalid_result_ack");
        this.journal.save({ ...receipt, phase: "acknowledged" });
        return report.ok ? { status: "completed", taskId: report.taskId } : { status: "failed", taskId: report.taskId, reason: (report.detail as {
                error: string;
            }).error };
    }
    private async runExclusive(): Promise<WindowsWorkerRunResult> {
        const beat = await this.postSigned(HEARTBEAT_PATH, { status: "ready", runtime: "windows-verification-v1" });
        if (!beat.response.ok)
            throw new Error("windows_worker_broker_heartbeat_failed");
        const node = isRecord(beat.payload) ? beat.payload.node : undefined;
        if (!isRecord(node) || node.id !== this.identity.nodeId || node.kind !== "windows" || !Array.isArray(node.capabilities) || !node.capabilities.includes("windows-tooling"))
            throw new Error("windows_worker_invalid_heartbeat_ack");
        if (node.status !== "ready" && node.status !== "busy")
            throw new Error("windows_worker_control_state_blocked");
        const pending = this.journal.read();
        if (pending && pending.phase !== "acknowledged" && pending.phase !== "rejected") {
            if (pending.phase === "started") {
                pending.phase = "result";
                pending.report = { taskId: pending.taskId, ok: false, detail: { schema: "jarvis.real-machine-result.v1", error: "windows_worker_interrupted_execution_unknown" } };
                this.journal.save(pending);
            }
            return this.deliver(pending);
        }
        const next = await this.postSigned(NEXT_PATH, { runtime: "windows-verification-v1" });
        if (!next.response.ok)
            throw new Error("windows_worker_broker_next_failed");
        if (!isRecord(next.payload) || !("task" in next.payload))
            throw new Error("windows_worker_invalid_next_response");
        if (next.payload.task === null)
            return { status: "idle" };
        if (!isRecord(next.payload.task))
            throw new Error("windows_worker_invalid_task_response");
        const task = structuredClone(next.payload.task) as unknown as JarvisTask;
        if (typeof task.id !== "string" || !SAFE_NODE_ID.test(task.id))
            throw new Error("windows_worker_invalid_task_id");
        const digest = createHash("sha256").update(JSON.stringify(task)).digest("hex");
        if (pending?.taskId === task.id) {
            if (pending.taskDigest !== digest)
                throw new Error("windows_worker_repeated_task_mismatch");
            if (pending.phase === "rejected")
                return { status: "failed", taskId: task.id, reason: "windows_worker_result_rejected" };
            return this.deliver(pending);
        }
        const receipt: WindowsWorkerReceipt = { version: 1, binding: this.binding, taskId: task.id, taskDigest: digest, phase: "started" };
        // Persist before execution. An interrupted process has UNKNOWN execution, never a safe automatic retry.
        this.journal.save(receipt);
        let report: WindowsWorkerReport;
        try {
            validateWindowsVerificationTask(task, this.identity.nodeId);
            const detail = await this.execute(task, this.identity.nodeId);
            report = { taskId: task.id, ok: true, detail };
            if (!validWindowsReport(report))
                throw new Error("windows_worker_invalid_execution_evidence");
        }
        catch (error) {
            report = { taskId: task.id, ok: false, detail: { schema: "jarvis.real-machine-result.v1", error: controlledFailure(error) } };
        }
        receipt.phase = "result";
        receipt.report = report;
        this.journal.save(receipt);
        // Delivery failures never enter the execution-failure path or change the saved outcome.
        return this.deliver(receipt);
    }
    private async postSigned(path: string, payload: unknown): Promise<{
        response: Response;
        payload: unknown;
    }> {
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
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
        });
        if (response.redirected || response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => { });
            throw new Error("windows_worker_redirect_denied");
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
            void response.body?.cancel().catch(() => { });
            throw new Error("windows_worker_invalid_response_type");
        }
        return { response, payload: await readBoundedJson(response) };
    }
}
