import { closeSync, existsSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RemoteAssistRecording, RemoteAssistRecordingStatus } from "./remote-assist-recording.ts";

const RECORDING_ID_RE = /^[0-9a-f-]{36}$/i;
const FRAME_NAME_RE = /^frame-(\d{4})\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const MAX_FRAMES = 60;
const MAX_DIRECTORY_ENTRIES = 256;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 5_000;

const RECORDING_STATUSES = new Set<RemoteAssistRecordingStatus>([
  "recording",
  "stopping",
  "completed",
  "stopped",
  "failed",
]);

export type RemoteAssistRecordingHistoryErrorCode =
  | "invalid-request"
  | "not-found"
  | "not-ready"
  | "unsafe-artifact"
  | "resource-limit"
  | "unavailable";

export class JarvisRemoteAssistRecordingHistoryError extends Error {
  constructor(
    readonly code: RemoteAssistRecordingHistoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JarvisRemoteAssistRecordingHistoryError";
  }
}

export type RemoteAssistRecordingHistoryItem = RemoteAssistRecording & {
  partial: boolean;
  replayable: boolean;
  stale: boolean;
};

export type RemoteAssistRecordingFrame = {
  recordingId: string;
  frameNumber: number;
  mimeType: "image/png";
  imageBase64: string;
};

export type RemoteAssistRecordingBundle = {
  version: 1;
  recording: RemoteAssistRecordingHistoryItem;
  frames: RemoteAssistRecordingFrame[];
};

function historyItem(recording: RemoteAssistRecording, now = Date.now()): RemoteAssistRecordingHistoryItem {
  const active = recording.status === "recording" || recording.status === "stopping";
  const updatedAt = Date.parse(recording.updatedAt);
  return {
    ...recording,
    partial: recording.status === "failed" && recording.frameCount > 0,
    replayable: !active && recording.frameCount > 0,
    stale: active && (!Number.isFinite(updatedAt) || now - updatedAt > Math.max(10_000, recording.intervalMs * 3)),
  };
}

function isFiniteTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

export class JarvisRemoteAssistRecordingHistory {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolve(process.cwd(), ".jarvis", "remote-assist-recordings");
  }

  listRecent(limit = 10): RemoteAssistRecordingHistoryItem[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new JarvisRemoteAssistRecordingHistoryError("invalid-request", "limit must be an integer between 1 and 50");
    }
    if (!existsSync(this.rootDir)) return [];
    const ids = this.listRecordingIds();
    return ids
      .map((id) => this.readManifest(id))
      .filter((recording): recording is RemoteAssistRecording => Boolean(recording))
      .map((recording) => historyItem(recording))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  get(recordingId: string): RemoteAssistRecordingHistoryItem {
    this.assertRecordingId(recordingId);
    const recording = this.readManifest(recordingId);
    if (!recording) {
      throw new JarvisRemoteAssistRecordingHistoryError("not-found", "Remote Assist recording not found");
    }
    return historyItem(recording);
  }

  readFrame(recordingId: string, frameNumber: number): RemoteAssistRecordingFrame {
    const recording = this.get(recordingId);
    if (!recording.replayable) {
      throw new JarvisRemoteAssistRecordingHistoryError("not-ready", "Remote Assist recording is not ready for replay");
    }
    if (!Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > recording.frameCount) {
      throw new JarvisRemoteAssistRecordingHistoryError("invalid-request", "invalid frameNumber");
    }
    const frameName = `frame-${String(frameNumber).padStart(4, "0")}.png`;
    if (!FRAME_NAME_RE.test(frameName)) {
      throw new JarvisRemoteAssistRecordingHistoryError("invalid-request", "invalid frameName");
    }
    const recordingDir = this.safeRecordingDir(recordingId);
    const framePath = resolve(recordingDir, frameName);
    const bytes = this.readBoundedFile(framePath, recordingDir, MAX_FRAME_BYTES, "frame");
    if (!isPng(bytes)) {
      throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", "Remote Assist recording frame is invalid");
    }
    if (bytes.length > recording.totalBytes) {
      throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", "Remote Assist recording byte accounting is invalid");
    }
    return {
      recordingId,
      frameNumber,
      mimeType: "image/png",
      imageBase64: bytes.toString("base64"),
    };
  }

  exportBundle(recordingId: string): RemoteAssistRecordingBundle {
    const recording = this.get(recordingId);
    if (!recording.replayable) {
      throw new JarvisRemoteAssistRecordingHistoryError("not-ready", "Remote Assist recording is not ready for export");
    }
    const frames: RemoteAssistRecordingFrame[] = [];
    let aggregateBytes = 0;
    for (let index = 0; index < recording.frameCount; index += 1) {
      const frame = this.readFrame(recordingId, index + 1);
      aggregateBytes += Buffer.byteLength(frame.imageBase64, "base64");
      if (aggregateBytes > MAX_RECORDING_BYTES || aggregateBytes > recording.totalBytes) {
        throw new JarvisRemoteAssistRecordingHistoryError("resource-limit", "Remote Assist recording export exceeds safe size bounds");
      }
      frames.push(frame);
    }
    if (aggregateBytes !== recording.totalBytes) {
      throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", "Remote Assist recording byte accounting is invalid");
    }
    return { version: 1, recording, frames };
  }

  private assertRecordingId(recordingId: string): void {
    if (!RECORDING_ID_RE.test(recordingId)) {
      throw new JarvisRemoteAssistRecordingHistoryError("invalid-request", "invalid recordingId");
    }
  }

  private listRecordingIds(): string[] {
    let dir: ReturnType<typeof opendirSync> | undefined;
    try {
      dir = opendirSync(this.rootDir);
      const ids: string[] = [];
      let inspected = 0;
      while (true) {
        const entry = dir.readSync();
        if (!entry) break;
        inspected += 1;
        if (inspected > MAX_DIRECTORY_ENTRIES) {
          throw new JarvisRemoteAssistRecordingHistoryError("resource-limit", "Remote Assist recording directory exceeds safe entry limit");
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && RECORDING_ID_RE.test(entry.name)) ids.push(entry.name);
      }
      return ids;
    } catch (error) {
      if (error instanceof JarvisRemoteAssistRecordingHistoryError) throw error;
      throw new JarvisRemoteAssistRecordingHistoryError("unavailable", "Remote Assist recording history unavailable");
    } finally {
      try { dir?.closeSync(); } catch { /* Directory may already be closed by the runtime. */ }
    }
  }

  private safeRecordingDir(recordingId: string): string {
    this.assertRecordingId(recordingId);
    try {
      if (!existsSync(this.rootDir)) {
        throw new JarvisRemoteAssistRecordingHistoryError("not-found", "Remote Assist recording not found");
      }
      const root = realpathSync(this.rootDir);
      const candidate = resolve(this.rootDir, recordingId);
      if (!existsSync(candidate)) {
        throw new JarvisRemoteAssistRecordingHistoryError("not-found", "Remote Assist recording not found");
      }
      const stat = lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", "Remote Assist recording path is unsafe");
      }
      const real = realpathSync(candidate);
      if (dirname(real) !== root) {
        throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", "Remote Assist recording path is unsafe");
      }
      return real;
    } catch (error) {
      if (error instanceof JarvisRemoteAssistRecordingHistoryError) throw error;
      throw new JarvisRemoteAssistRecordingHistoryError("unavailable", "Remote Assist recording history unavailable");
    }
  }

  private readBoundedFile(path: string, recordingDir: string, maxBytes: number, kind: "manifest" | "frame"): Buffer {
    let fd: number | undefined;
    try {
      if (!existsSync(path)) {
        throw new JarvisRemoteAssistRecordingHistoryError("not-found", `Remote Assist recording ${kind} not found`);
      }
      const pathStat = lstatSync(path);
      if (!pathStat.isFile() || pathStat.isSymbolicLink() || dirname(realpathSync(path)) !== recordingDir) {
        throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", `Remote Assist recording ${kind} path is unsafe`);
      }
      if (pathStat.size < 1 || pathStat.size > maxBytes) {
        throw new JarvisRemoteAssistRecordingHistoryError("resource-limit", `Remote Assist recording ${kind} exceeds safe size bounds`);
      }
      fd = openSync(path, "r");
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size < 1 || opened.size > maxBytes) {
        throw new JarvisRemoteAssistRecordingHistoryError("resource-limit", `Remote Assist recording ${kind} exceeds safe size bounds`);
      }
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== buffer.length) {
        throw new JarvisRemoteAssistRecordingHistoryError("unsafe-artifact", `Remote Assist recording ${kind} changed while being read`);
      }
      return buffer;
    } catch (error) {
      if (error instanceof JarvisRemoteAssistRecordingHistoryError) throw error;
      throw new JarvisRemoteAssistRecordingHistoryError("unavailable", `Remote Assist recording ${kind} unavailable`);
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* Nothing useful can be recovered from a close failure. */ }
      }
    }
  }

  private readManifest(recordingId: string): RemoteAssistRecording | undefined {
    try {
      const recordingDir = this.safeRecordingDir(recordingId);
      const path = resolve(recordingDir, "manifest.json");
      const bytes = this.readBoundedFile(path, recordingDir, MAX_MANIFEST_BYTES, "manifest");
      const parsed = JSON.parse(bytes.toString("utf8")) as Partial<RemoteAssistRecording>;
      if (parsed.id !== recordingId || typeof parsed.sessionId !== "string" || parsed.sessionId.length === 0 || typeof parsed.serial !== "string" || parsed.serial.length === 0) return undefined;
      if (!parsed.status || !RECORDING_STATUSES.has(parsed.status)) return undefined;
      if (!isFiniteTimestamp(parsed.createdAt) || !isFiniteTimestamp(parsed.updatedAt) || !isFiniteTimestamp(parsed.expiresAt)) return undefined;
      const createdAt = Date.parse(parsed.createdAt);
      const updatedAt = Date.parse(parsed.updatedAt);
      const expiresAt = Date.parse(parsed.expiresAt);
      if (updatedAt < createdAt || expiresAt < createdAt) return undefined;
      if (!isBoundedInteger(parsed.intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS)) return undefined;
      if (!isBoundedInteger(parsed.maxFrames, 1, MAX_FRAMES)) return undefined;
      if (!isBoundedInteger(parsed.frameCount, 0, parsed.maxFrames)) return undefined;
      if (!isBoundedInteger(parsed.totalBytes, 0, MAX_RECORDING_BYTES)) return undefined;
      if ((parsed.frameCount === 0) !== (parsed.totalBytes === 0)) return undefined;
      return parsed as RemoteAssistRecording;
    } catch {
      return undefined;
    }
  }
}
