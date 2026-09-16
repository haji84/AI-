import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type RemoteAssistRecordingStatus = "recording" | "stopping" | "completed" | "stopped" | "failed";

export type RemoteAssistRecording = {
  id: string;
  sessionId: string;
  serial: string;
  status: RemoteAssistRecordingStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  intervalMs: number;
  maxFrames: number;
  frameCount: number;
  totalBytes: number;
  stopReason?: "duration" | "frame-limit" | "storage-limit" | "owner-stop" | "process-restart" | "capture-error" | "capture-timeout" | "storage-error" | "audit-error";
};

export type RemoteAssistCapturedFrame = {
  mimeType: string;
  imageBase64: string;
  capturedAt: string;
};

type InternalRecording = RemoteAssistRecording & { stopRequested: boolean; controller: AbortController };

type RecorderOptions = {
  rootDir?: string;
  captureFrame: (serial: string, context: { sessionId: string; signal: AbortSignal }) => Promise<RemoteAssistCapturedFrame>;
  beforeStart?: (recording: RemoteAssistRecording) => void;
  validateCapture?: (sessionId: string, serial: string) => void;
  onFinished?: (recording: RemoteAssistRecording) => void;
  defaultDurationMs?: number;
  maxDurationMs?: number;
  minDurationMs?: number;
  defaultIntervalMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  maxFrames?: number;
  maxFrameBytes?: number;
  maxRecordingBytes?: number;
  maxRecordings?: number;
};

const RECORDING_ID_RE = /^[0-9a-f-]{36}$/i;

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

function publicRecording(recording: InternalRecording): RemoteAssistRecording {
  return {
    id: recording.id,
    sessionId: recording.sessionId,
    serial: recording.serial,
    status: recording.status,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    expiresAt: recording.expiresAt,
    intervalMs: recording.intervalMs,
    maxFrames: recording.maxFrames,
    frameCount: recording.frameCount,
    totalBytes: recording.totalBytes,
    ...(recording.stopReason ? { stopReason: recording.stopReason } : {}),
  };
}

export class JarvisRemoteAssistFrameRecorder {
  private readonly rootDir: string;
  private readonly captureFrame: RecorderOptions["captureFrame"];
  private readonly onFinished?: RecorderOptions["onFinished"];
  private readonly beforeStart?: RecorderOptions["beforeStart"];
  private readonly validateCapture?: RecorderOptions["validateCapture"];
  private readonly defaultDurationMs: number;
  private readonly maxDurationMs: number;
  private readonly minDurationMs: number;
  private readonly defaultIntervalMs: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly maxFramesLimit: number;
  private readonly maxFrameBytes: number;
  private readonly maxRecordingBytes: number;
  private readonly maxRecordings: number;
  private readonly recordings = new Map<string, InternalRecording>();
  private readonly activeBySerial = new Map<string, string>();
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(options: RecorderOptions) {
    this.rootDir = options.rootDir ?? resolve(process.cwd(), ".jarvis", "remote-assist-recordings");
    this.captureFrame = options.captureFrame;
    this.onFinished = options.onFinished;
    this.beforeStart = options.beforeStart;
    this.validateCapture = options.validateCapture;
    this.defaultDurationMs = options.defaultDurationMs ?? 300_000;
    this.maxDurationMs = options.maxDurationMs ?? 300_000;
    this.minDurationMs = options.minDurationMs ?? 2_000;
    this.defaultIntervalMs = options.defaultIntervalMs ?? 2_000;
    this.minIntervalMs = options.minIntervalMs ?? 500;
    this.maxIntervalMs = options.maxIntervalMs ?? 5_000;
    this.maxFramesLimit = options.maxFrames ?? 600;
    this.maxFrameBytes = options.maxFrameBytes ?? 8 * 1024 * 1024;
    this.maxRecordingBytes = options.maxRecordingBytes ?? 512 * 1024 * 1024;
    this.maxRecordings = options.maxRecordings ?? 10;
    if (this.minDurationMs <= 0 || this.maxDurationMs < this.minDurationMs) throw new Error("invalid duration bounds");
    if (this.minIntervalMs <= 0 || this.maxIntervalMs < this.minIntervalMs) throw new Error("invalid interval bounds");
    if (this.maxFramesLimit <= 0 || this.maxFrameBytes <= 0 || this.maxRecordingBytes <= 0 || this.maxRecordings <= 0) throw new Error("recording limits must be positive");
    mkdirSync(this.rootDir, { recursive: true });
    this.recoverInterruptedRecordings();
    this.pruneOldRecordings();
  }

  start(input: { sessionId: string; serial: string; durationMs?: number; intervalMs?: number }, now = new Date()): RemoteAssistRecording {
    if (!input.sessionId || !input.serial) throw new Error("sessionId and serial are required");
    if (this.activeBySerial.has(input.serial)) throw new Error("this device already has an active Remote Assist recording");
    const durationMs = bounded(input.durationMs, this.defaultDurationMs, this.minDurationMs, this.maxDurationMs, "durationMs");
    const intervalMs = bounded(input.intervalMs, this.defaultIntervalMs, this.minIntervalMs, this.maxIntervalMs, "intervalMs");
    const theoreticalFrames = Math.max(1, Math.ceil(durationMs / intervalMs));
    const maxFrames = Math.min(theoreticalFrames, this.maxFramesLimit);
    const id = randomUUID();
    const timestamp = now.toISOString();
    const recording: InternalRecording = {
      id,
      sessionId: input.sessionId,
      serial: input.serial,
      status: "recording",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
      intervalMs,
      maxFrames,
      frameCount: 0,
      totalBytes: 0,
      stopRequested: false,
      controller: new AbortController(),
    };
    this.validateCapture?.(recording.sessionId, recording.serial);
    this.beforeStart?.(publicRecording(recording));
    mkdirSync(this.recordingDir(id), { recursive: true });
    this.persist(recording);
    this.recordings.set(id, recording);
    this.activeBySerial.set(input.serial, id);
    try { this.pruneOldRecordings(); } catch (error) {
      this.activeBySerial.delete(input.serial);
      recording.status = "failed";
      recording.stopReason = "storage-error";
      try { this.persist(recording); } catch { /* The in-memory failure remains visible. */ }
      throw error;
    }
    const job = Promise.resolve().then(() => this.run(recording));
    this.jobs.set(id, job);
    void job.then(() => this.jobs.delete(id), () => this.jobs.delete(id));
    return publicRecording(recording);
  }

  status(recordingId: string, sessionId: string, serial: string): RemoteAssistRecording {
    const recording = this.requireBound(recordingId, sessionId, serial);
    return publicRecording(recording);
  }

  async stop(recordingId: string, sessionId: string, serial: string): Promise<RemoteAssistRecording> {
    const recording = this.requireBound(recordingId, sessionId, serial);
    if (recording.status !== "recording" && recording.status !== "stopping") return publicRecording(recording);
    recording.stopRequested = true;
    recording.status = "stopping";
    recording.updatedAt = new Date().toISOString();
    recording.controller.abort();
    await this.jobs.get(recording.id);
    return publicRecording(recording);
  }

  async stopForSession(sessionId: string): Promise<void> {
    const active = [...this.recordings.values()].filter((item) => item.sessionId === sessionId && (item.status === "recording" || item.status === "stopping"));
    await Promise.all(active.map((item) => this.stop(item.id, item.sessionId, item.serial)));
  }

  private async run(recording: InternalRecording): Promise<void> {
    try {
      const deadline = new Date(recording.expiresAt).getTime();
      while (!recording.stopRequested && Date.now() < deadline && recording.frameCount < recording.maxFrames) {
        const frameStartedAt = Date.now();
        this.validateCapture?.(recording.sessionId, recording.serial);
        const frame = await this.captureWithinDeadline(recording, deadline);
        if (recording.stopRequested || Date.now() >= deadline) break;
        this.validateCapture?.(recording.sessionId, recording.serial);
        if (frame.mimeType !== "image/png") throw new Error("Remote Assist recording only accepts image/png frames");
        const bytes = Buffer.from(frame.imageBase64, "base64");
        if (!bytes.length || bytes.length > this.maxFrameBytes) throw new Error("Remote Assist recording frame exceeds safe size bounds");
        if (recording.totalBytes + bytes.length > this.maxRecordingBytes) {
          recording.stopReason = "storage-limit";
          break;
        }
        const nextFrame = recording.frameCount + 1;
        writeFileSync(resolve(this.recordingDir(recording.id), `frame-${String(nextFrame).padStart(4, "0")}.png`), bytes, { mode: 0o600 });
        recording.frameCount = nextFrame;
        recording.totalBytes += bytes.length;
        recording.updatedAt = frame.capturedAt || new Date().toISOString();
        this.persist(recording);
        if (recording.stopRequested || recording.frameCount >= recording.maxFrames || Date.now() >= deadline) break;
        const waitMs = Math.min(recording.intervalMs - (Date.now() - frameStartedAt), deadline - Date.now());
        if (waitMs > 0) await this.waitForNextFrame(recording, waitMs);
      }
      if (recording.stopRequested) {
        recording.status = "stopped";
        recording.stopReason = "owner-stop";
      } else if (recording.stopReason === "storage-limit") {
        recording.status = "stopped";
      } else {
        recording.status = "completed";
        recording.stopReason = recording.frameCount >= recording.maxFrames ? "frame-limit" : "duration";
      }
    } catch (error) {
      recording.status = recording.stopRequested ? "stopped" : "failed";
      recording.stopReason = recording.stopRequested ? "owner-stop" : error instanceof Error && error.message === "capture-timeout" ? "capture-timeout" : "capture-error";
    } finally {
      recording.updatedAt = new Date().toISOString();
      this.activeBySerial.delete(recording.serial);
      try { this.persist(recording); } catch {
        recording.status = "failed";
        recording.stopReason = "storage-error";
      }
      try { this.onFinished?.(publicRecording(recording)); } catch {
        recording.status = "failed";
        recording.stopReason = "audit-error";
        try { this.persist(recording); } catch { recording.stopReason = "storage-error"; }
      }
    }
  }

  private async captureWithinDeadline(recording: InternalRecording, deadline: number): Promise<RemoteAssistCapturedFrame> {
    const signal = recording.controller.signal;
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("capture aborted"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        const error = new Error("capture-timeout");
        reject(error);
        recording.controller.abort(error);
      }, Math.max(1, deadline - Date.now()));
    });
    try {
      return await Promise.race([
        this.captureFrame(recording.serial, { sessionId: recording.sessionId, signal }),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  private waitForNextFrame(recording: InternalRecording, ms: number): Promise<void> {
    return new Promise(resolvePromise => {
      const signal = recording.controller.signal;
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolvePromise(); };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }

  private requireBound(recordingId: string, sessionId: string, serial: string): InternalRecording {
    if (!RECORDING_ID_RE.test(recordingId)) throw new Error("invalid recordingId");
    let recording = this.recordings.get(recordingId);
    if (!recording) {
      const persisted = this.loadPersisted(recordingId);
      if (persisted) {
        recording = { ...persisted, stopRequested: false, controller: new AbortController() };
        this.recordings.set(recording.id, recording);
      }
    }
    if (!recording) throw new Error("Remote Assist recording not found");
    if (recording.sessionId !== sessionId || recording.serial !== serial) throw new Error("Remote Assist recording belongs to another session or device");
    return recording;
  }

  private recordingDir(id: string): string {
    if (!RECORDING_ID_RE.test(id)) throw new Error("invalid recordingId");
    return resolve(this.rootDir, id);
  }

  private manifestPath(id: string): string {
    return resolve(this.recordingDir(id), "manifest.json");
  }

  private persist(recording: InternalRecording): void {
    writeFileSync(this.manifestPath(recording.id), `${JSON.stringify(publicRecording(recording), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private loadPersisted(id: string): RemoteAssistRecording | undefined {
    const path = this.manifestPath(id);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as RemoteAssistRecording;
    } catch {
      return undefined;
    }
  }

  private recoverInterruptedRecordings(): void {
    for (const entry of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RECORDING_ID_RE.test(entry.name)) continue;
      const persisted = this.loadPersisted(entry.name);
      if (!persisted || (persisted.status !== "recording" && persisted.status !== "stopping")) continue;
      const recovered: InternalRecording = {
        ...persisted,
        status: "failed",
        stopReason: "process-restart",
        updatedAt: new Date().toISOString(),
        stopRequested: false,
        controller: new AbortController(),
      };
      this.persist(recovered);
    }
  }

  private pruneOldRecordings(): void {
    const directories = readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RECORDING_ID_RE.test(entry.name))
      .map((entry) => ({ name: entry.name, mtimeMs: statSync(resolve(this.rootDir, entry.name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const old of directories.slice(this.maxRecordings)) {
      if (this.activeBySerial.get(this.recordings.get(old.name)?.serial ?? "") === old.name) continue;
      rmSync(resolve(this.rootDir, old.name), { recursive: true, force: true });
      this.recordings.delete(old.name);
    }
  }
}
