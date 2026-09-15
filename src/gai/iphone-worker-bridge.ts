import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IosManagedExecutionBridge, IosManagedExecutionRequest, IosManagedExecutionResult } from "./initial-worker-adapters.ts";
import type { WorkerCapability, WorkerConnectivity } from "./worker-runtime.ts";

export interface IphoneEnrollment {
  deviceId: string;
  token: string;
  capabilities: WorkerCapability[];
  expiresAt: string;
}

export interface IphoneTaskEnvelope {
  protocolVersion: 1;
  taskId: string;
  deviceId: string;
  capability: WorkerCapability;
  mode: IosManagedExecutionRequest["mode"];
  input: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}

export interface IphoneResultEnvelope {
  protocolVersion: 1;
  taskId: string;
  deviceId: string;
  ok: boolean;
  output: string;
  evidence: Record<string, unknown>;
  completedAt: string;
  nonce: string;
  signature: string;
}

export interface IphoneTransport {
  connectivity(): Promise<WorkerConnectivity>;
  deliver(task: IphoneTaskEnvelope): Promise<IphoneResultEnvelope>;
}

export interface IphoneBridgeOptions {
  enrollment: IphoneEnrollment;
  transport: IphoneTransport;
  now?: () => Date;
  taskTtlMs?: number;
}

function canonical(value: Omit<IphoneTaskEnvelope, "signature"> | Omit<IphoneResultEnvelope, "signature">): string {
  return JSON.stringify(value);
}

function sign(value: Omit<IphoneTaskEnvelope, "signature"> | Omit<IphoneResultEnvelope, "signature">, token: string): string {
  return createHmac("sha256", token).update(canonical(value)).digest("hex");
}

function equalSignature(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signIphoneResult(value: Omit<IphoneResultEnvelope, "signature">, token: string): IphoneResultEnvelope {
  return { ...value, signature: sign(value, token) };
}

export class PhysicalIphoneWorkerBridge implements IosManagedExecutionBridge {
  readonly capabilities: WorkerCapability[];
  private readonly enrollment: IphoneEnrollment;
  private readonly transport: IphoneTransport;
  private readonly now: () => Date;
  private readonly taskTtlMs: number;
  private readonly completed = new Map<string, IosManagedExecutionResult>();
  private readonly pending = new Map<string, Promise<IosManagedExecutionResult>>();

  constructor(options: IphoneBridgeOptions) {
    this.enrollment = options.enrollment;
    this.transport = options.transport;
    this.now = options.now ?? (() => new Date());
    this.taskTtlMs = options.taskTtlMs ?? 5 * 60_000;
    this.capabilities = [...new Set(options.enrollment.capabilities)].sort();
  }

  async available(): Promise<boolean> {
    if (this.now().getTime() >= Date.parse(this.enrollment.expiresAt)) return false;
    return (await this.transport.connectivity()) !== "offline";
  }

  async health() {
    const connectivity = await this.transport.connectivity();
    return {
      available: connectivity !== "offline" && this.now().getTime() < Date.parse(this.enrollment.expiresAt),
      connectivity,
      detail: `physical iphone enrollment ${this.enrollment.deviceId}`,
    };
  }

  async execute(request: IosManagedExecutionRequest): Promise<IosManagedExecutionResult> {
    const cached = this.completed.get(request.taskId);
    if (cached) return cached;
    const existing = this.pending.get(request.taskId);
    if (existing) return existing;

    const execution = this.executeOnce(request).finally(() => this.pending.delete(request.taskId));
    this.pending.set(request.taskId, execution);
    return execution;
  }

  private async executeOnce(request: IosManagedExecutionRequest): Promise<IosManagedExecutionResult> {
    const now = this.now();
    if (now.getTime() >= Date.parse(this.enrollment.expiresAt)) throw new Error("iPhone enrollment expired");
    if (!this.capabilities.includes(request.capability)) throw new Error(`iPhone enrollment does not authorize ${request.capability}`);
    if ((await this.transport.connectivity()) === "offline") throw new Error("WAITING_FOR_CONNECTIVITY");

    const unsigned: Omit<IphoneTaskEnvelope, "signature"> = {
      protocolVersion: 1,
      taskId: request.taskId,
      deviceId: this.enrollment.deviceId,
      capability: request.capability,
      mode: request.mode,
      input: request.input,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.taskTtlMs).toISOString(),
      nonce: randomBytes(16).toString("hex"),
    };
    const task: IphoneTaskEnvelope = { ...unsigned, signature: sign(unsigned, this.enrollment.token) };
    const result = await this.transport.deliver(task);
    this.verifyResult(task, result);
    if (!result.ok) throw new Error(result.output || "physical iPhone task failed");

    const normalized: IosManagedExecutionResult = {
      output: result.output,
      evidence: {
        ...result.evidence,
        physicalDevice: true,
        platform: "ios",
        deviceId: this.enrollment.deviceId,
        taskId: request.taskId,
        completedAt: result.completedAt,
        protocolVersion: result.protocolVersion,
      },
    };
    this.completed.set(request.taskId, normalized);
    return normalized;
  }

  private verifyResult(task: IphoneTaskEnvelope, result: IphoneResultEnvelope): void {
    if (result.protocolVersion !== 1) throw new Error("unsupported iPhone result protocol");
    if (result.taskId !== task.taskId || result.deviceId !== this.enrollment.deviceId) throw new Error("iPhone result binding mismatch");
    if (result.nonce !== task.nonce) throw new Error("iPhone result replay/binding mismatch");
    if (Date.parse(result.completedAt) > Date.parse(task.expiresAt)) throw new Error("iPhone result expired");
    const { signature, ...unsigned } = result;
    if (!equalSignature(signature, sign(unsigned, this.enrollment.token))) throw new Error("invalid iPhone result signature");
  }
}
