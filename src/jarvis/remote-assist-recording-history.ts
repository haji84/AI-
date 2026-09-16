import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RemoteAssistRecording } from "./remote-assist-recording.ts";

const RECORDING_ID_RE = /^[0-9a-f-]{36}$/i;
const FRAME_NAME_RE = /^frame-(\d{4})\.png$/;

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

export class JarvisRemoteAssistRecordingHistory {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? resolve(process.cwd(), ".jarvis", "remote-assist-recordings");
  }

  listRecent(limit = 10): RemoteAssistRecordingHistoryItem[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer between 1 and 50");
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && RECORDING_ID_RE.test(entry.name))
      .map((entry) => this.readManifest(entry.name))
      .filter((recording): recording is RemoteAssistRecording => Boolean(recording))
      .map((recording) => historyItem(recording))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  get(recordingId: string): RemoteAssistRecordingHistoryItem {
    this.assertRecordingId(recordingId);
    const recording = this.readManifest(recordingId);
    if (!recording) throw new Error("Remote Assist recording not found");
    return historyItem(recording);
  }

  readFrame(recordingId: string, frameNumber: number): RemoteAssistRecordingFrame {
    const recording = this.get(recordingId);
    if (!recording.replayable) throw new Error("Remote Assist recording is not ready for replay");
    if (!Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > recording.frameCount) throw new Error("invalid frameNumber");
    const frameName = `frame-${String(frameNumber).padStart(4, "0")}.png`;
    if (!FRAME_NAME_RE.test(frameName)) throw new Error("invalid frameName");
    const recordingDir = this.safeRecordingDir(recordingId);
    const framePath = resolve(recordingDir, frameName);
    if (!existsSync(framePath)) throw new Error("Remote Assist recording frame not found");
    const stat = lstatSync(framePath);
    if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(framePath)) !== recordingDir) {
      throw new Error("Remote Assist recording frame path is unsafe");
    }
    return {
      recordingId,
      frameNumber,
      mimeType: "image/png",
      imageBase64: readFileSync(framePath).toString("base64"),
    };
  }

  exportBundle(recordingId: string): RemoteAssistRecordingBundle {
    const recording = this.get(recordingId);
    if (!recording.replayable) throw new Error("Remote Assist recording is not ready for export");
    const frames = Array.from({ length: recording.frameCount }, (_unused, index) => this.readFrame(recordingId, index + 1));
    return { version: 1, recording, frames };
  }

  private assertRecordingId(recordingId: string): void {
    if (!RECORDING_ID_RE.test(recordingId)) throw new Error("invalid recordingId");
  }

  private safeRecordingDir(recordingId: string): string {
    this.assertRecordingId(recordingId);
    if (!existsSync(this.rootDir)) throw new Error("Remote Assist recording not found");
    const root = realpathSync(this.rootDir);
    const candidate = resolve(this.rootDir, recordingId);
    if (!existsSync(candidate)) throw new Error("Remote Assist recording not found");
    const stat = lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Remote Assist recording path is unsafe");
    const real = realpathSync(candidate);
    if (dirname(real) !== root) throw new Error("Remote Assist recording path is unsafe");
    return real;
  }

  private readManifest(recordingId: string): RemoteAssistRecording | undefined {
    try {
      const recordingDir = this.safeRecordingDir(recordingId);
      const path = resolve(recordingDir, "manifest.json");
      if (!existsSync(path)) return undefined;
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(path)) !== recordingDir) return undefined;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RemoteAssistRecording>;
      if (parsed.id !== recordingId || !parsed.sessionId || !parsed.serial || !parsed.status || !parsed.createdAt || !parsed.updatedAt) return undefined;
      if (!Number.isInteger(parsed.frameCount) || (parsed.frameCount ?? -1) < 0 || !Number.isInteger(parsed.totalBytes) || (parsed.totalBytes ?? -1) < 0) return undefined;
      return parsed as RemoteAssistRecording;
    } catch {
      return undefined;
    }
  }
}
