import { createHash } from "node:crypto";

export type DevelopmentIntakePlatform = "ios" | "windows" | "macos";
export type DevelopmentIntakeConnectivity = "online" | "degraded" | "offline" | "recovering";

export interface DeviceDevelopmentRequest {
  deviceId: string;
  platform: DevelopmentIntakePlatform;
  ownerCommandId: string;
  text: string;
  connectivity: DevelopmentIntakeConnectivity;
  goalSnapshotDigest: string;
  causalParentId?: string;
}

export interface DeviceDevelopmentRecord extends DeviceDevelopmentRequest {
  recordId: string;
  status: "QUEUED_OFFLINE" | "SUBMITTED";
  decision?: { goalId?: string; action: string };
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDevelopmentInbox {
  list(): Promise<DeviceDevelopmentRecord[]>;
  put(record: DeviceDevelopmentRecord): Promise<void>;
}

export class MemoryDeviceDevelopmentInbox implements DeviceDevelopmentInbox {
  private readonly records = new Map<string, DeviceDevelopmentRecord>();
  async list() { return [...this.records.values()].map((value) => structuredClone(value)); }
  async put(record: DeviceDevelopmentRecord) { this.records.set(record.recordId, structuredClone(record)); }
}

export interface DeviceDevelopmentSubmitRequest {
  source: "device";
  text: string;
  idempotencyKey: string;
  sourceContext: Record<string, unknown>;
}

function recordId(commandId: string): string {
  return `device-intake-${createHash("sha256").update(commandId).digest("hex").slice(0, 32)}`;
}

export class DeviceDevelopmentIntake {
  private readonly inbox: DeviceDevelopmentInbox;
  private readonly submit: (request: DeviceDevelopmentSubmitRequest) => Promise<{ goalId?: string; action: string }>;

  constructor(options: { inbox: DeviceDevelopmentInbox; submit(request: DeviceDevelopmentSubmitRequest): Promise<{ goalId?: string; action: string }> }) {
    this.inbox = options.inbox;
    this.submit = options.submit;
  }

  async receive(request: DeviceDevelopmentRequest, now = new Date()): Promise<DeviceDevelopmentRecord> {
    if (!["ios", "windows", "macos"].includes(request.platform)) throw new Error("unsupported device platform");
    if (!request.deviceId.trim() || !request.ownerCommandId.trim() || !request.text.trim()) throw new Error("bounded device development intake is required");
    if (!/^[a-f0-9]{64}$/.test(request.goalSnapshotDigest)) throw new Error("goal snapshot digest is invalid");
    const records = await this.inbox.list();
    const existing = records.find((record) => record.ownerCommandId === request.ownerCommandId);
    if (existing) return existing;
    if (request.platform === "ios" && records.some((record) => record.platform === "ios" && record.deviceId !== request.deviceId)) {
      throw new Error("one iPhone topology does not permit a second iPhone identity");
    }
    const at = now.toISOString();
    const value: DeviceDevelopmentRecord = {
      ...structuredClone(request),
      recordId: recordId(request.ownerCommandId),
      status: request.connectivity === "online" || request.connectivity === "recovering" ? "SUBMITTED" : "QUEUED_OFFLINE",
      createdAt: at,
      updatedAt: at,
    };
    if (value.status === "SUBMITTED") value.decision = await this.submitRequest(value);
    await this.inbox.put(value);
    return structuredClone(value);
  }

  async flush(connectivity: DevelopmentIntakeConnectivity, now = new Date()): Promise<DeviceDevelopmentRecord[]> {
    if (connectivity !== "online" && connectivity !== "recovering") return [];
    const flushed: DeviceDevelopmentRecord[] = [];
    for (const record of await this.inbox.list()) {
      if (record.status !== "QUEUED_OFFLINE") continue;
      const submitted = { ...record, status: "SUBMITTED" as const, decision: await this.submitRequest(record), updatedAt: now.toISOString() };
      await this.inbox.put(submitted);
      flushed.push(structuredClone(submitted));
    }
    return flushed;
  }

  private submitRequest(record: DeviceDevelopmentRecord) {
    return this.submit({
      source: "device",
      text: record.text,
      idempotencyKey: record.ownerCommandId,
      sourceContext: {
        deviceId: record.deviceId,
        platform: record.platform,
        goalSnapshotDigest: record.goalSnapshotDigest,
        causalParentId: record.causalParentId ?? null,
        receivedOffline: record.connectivity === "offline" || record.connectivity === "degraded",
      },
    });
  }
}

