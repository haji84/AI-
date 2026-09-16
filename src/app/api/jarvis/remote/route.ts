import { remotePreview } from "../../../../jarvis/remote-preview.ts";
import { NextResponse } from "next/server";
import { JarvisRemoteAssistAuditStore } from "../../../../jarvis/remote-assist-audit.ts";
import { JarvisRemoteAssistFrameRecorder } from "../../../../jarvis/remote-assist-recording.ts";
import {
  JarvisRemoteAssistSessionManager,
  capabilityForRemoteDevice,
  isManualRemoteAction,
  remoteCapabilityAllowsAction,
} from "../../../../jarvis/remote-assist.ts";
import { jarvisRemoteGatewayFetch, requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

type RemotePayload =
  | { action: "session-start"; serial?: string; ttlMs?: number }
  | { action: "session-end"; sessionId?: string }
  | { action: "session-status"; sessionId?: string }
  | { action: "session-audit"; sessionId?: string }
  | { action: "recording-start"; serial?: string; sessionId?: string; durationMs?: number; intervalMs?: number }
  | { action: "recording-status"; serial?: string; sessionId?: string; recordingId?: string }
  | { action: "recording-stop"; serial?: string; sessionId?: string; recordingId?: string }
  | { action: "screenshot"; serial?: string; sessionId?: string }
  | { action: "tap"; serial?: string; sessionId?: string; x?: number; y?: number }
  | { action: "swipe"; serial?: string; sessionId?: string; x1?: number; y1?: number; x2?: number; y2?: number; durationMs?: number }
  | { action: "text"; serial?: string; sessionId?: string; text?: string }
  | { action: "keyevent"; serial?: string; sessionId?: string; key?: string }
  | { action: "open-url"; serial?: string; sessionId?: string; url?: string }
  | { action: "qa-sequence-start"; serial?: string; url1?: string; url2?: string; packageName?: string; timeoutMs?: number; pollMs?: number }
  | { action: "qa-sequence-status"; serial?: string; runId?: string };

type GatewayDevice = { serial: string; state: string };
type GatewayDevicesBody = { devices?: GatewayDevice[]; message?: string };
type GatewayScreenshotBody = { serial?: string; mimeType?: string; imageBase64?: string; capturedAt?: string; message?: string };

const globalForRemoteAssist = globalThis as typeof globalThis & {
  __jarvisRemoteAssistAuditStore?: JarvisRemoteAssistAuditStore;
  __jarvisRemoteAssistSessions?: JarvisRemoteAssistSessionManager;
  __jarvisRemoteAssistRecorder?: JarvisRemoteAssistFrameRecorder;
};

const auditStore = globalForRemoteAssist.__jarvisRemoteAssistAuditStore ?? new JarvisRemoteAssistAuditStore(
  process.env.JARVIS_REMOTE_ASSIST_AUDIT_PATH?.trim() || undefined,
);
globalForRemoteAssist.__jarvisRemoteAssistAuditStore = auditStore;

const remoteAssist = globalForRemoteAssist.__jarvisRemoteAssistSessions ?? new JarvisRemoteAssistSessionManager(
  10 * 60_000,
  30 * 60_000,
  1_000,
  (event) => auditStore.append(event),
);
globalForRemoteAssist.__jarvisRemoteAssistSessions = remoteAssist;

const recorder = globalForRemoteAssist.__jarvisRemoteAssistRecorder ?? new JarvisRemoteAssistFrameRecorder({
  rootDir: process.env.JARVIS_REMOTE_ASSIST_RECORDING_DIR?.trim() || undefined,
  beforeStart: (recording) => {
    remoteAssist.recordAudit("recording.started", recording.sessionId, recording.serial, {
      recordingId: recording.id,
      intervalMs: recording.intervalMs,
      maxFrames: recording.maxFrames,
    });
  },
  validateCapture: (sessionId, serial) => {
    const session = remoteAssist.requireActive(sessionId, serial);
    if (!remoteCapabilityAllowsAction(session.capability, "screenshot")) throw new Error("Remote Assist observation is unavailable");
  },
  captureFrame: async (serial, { signal }) => {
    const response = await jarvisRemoteGatewayFetch("/api/remote/screenshot", {
      method: "POST",
      body: JSON.stringify({ serial }),
      signal,
    });
    const body = await response.json().catch(() => ({ message: "Remote Gatewayから不正な応答を受信しました" })) as GatewayScreenshotBody;
    if (!response.ok || !body.imageBase64 || body.mimeType !== "image/png") {
      throw new Error(body.message || `Remote Gateway screenshot failed: HTTP ${response.status}`);
    }
    return {
      mimeType: body.mimeType,
      imageBase64: body.imageBase64,
      capturedAt: body.capturedAt || new Date().toISOString(),
    };
  },
  onFinished: (recording) => {
    const action = recording.status === "completed"
      ? "recording.completed"
      : recording.status === "stopped"
        ? "recording.stopped"
        : "recording.failed";
    try {
      remoteAssist.recordAudit(action, recording.sessionId, recording.serial, {
        recordingId: recording.id,
        frameCount: recording.frameCount,
        totalBytes: recording.totalBytes,
        stopReason: recording.stopReason,
      });
    } catch {
      throw new Error("Remote Assist recording audit persistence failed");
    }
  },
});
globalForRemoteAssist.__jarvisRemoteAssistRecorder = recorder;

function remoteSessionError(error: unknown) {
  return NextResponse.json({
    message: error instanceof Error ? error.message : "Remote Assist session is unavailable",
  }, { status: 409 });
}

async function gatewayDevices(): Promise<{ response: Response; body: GatewayDevicesBody }> {
  const response = await jarvisRemoteGatewayFetch("/api/remote/devices");
  const body = await response.json().catch(() => ({ message: "Remote Gatewayから不正な応答を受信しました" })) as GatewayDevicesBody;
  return { response, body };
}

function requireRecordingBinding(payload: Extract<RemotePayload, { action: "recording-start" | "recording-status" | "recording-stop" }>) {
  if (!payload.serial || !payload.sessionId) throw new Error("Remote Assist sessionを開始してください");
  const session = remoteAssist.requireActive(payload.sessionId, payload.serial);
  remoteAssist.touch(payload.sessionId, payload.serial);
  return session;
}

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try {
    const { response, body } = await gatewayDevices();
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    const devices = (body.devices ?? []).map((device) => ({
      ...device,
      remoteAssistCapability: capabilityForRemoteDevice({
        canView: device.state === "device",
        canControl: device.state === "device",
      }),
    }));
    return NextResponse.json({ ...body, devices }, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      message: "JARVIS Remote Gatewayに接続できません",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as RemotePayload | null;
  if (!payload?.action) return NextResponse.json({ message: "操作内容を指定してください" }, { status: 400 });

  if (payload.action === "session-status") {
    if (!payload.sessionId) return NextResponse.json({ message: "sessionIdが必要です" }, { status: 400 });
    const session = remoteAssist.get(payload.sessionId);
    if (!session) return NextResponse.json({ message: "Remote Assist sessionが見つかりません" }, { status: 404 });
    return NextResponse.json({ session });
  }

  if (payload.action === "session-audit") {
    try {
      return NextResponse.json({ audit: auditStore.list(payload.sessionId) });
    } catch (error) {
      return NextResponse.json({
        message: "Remote Assist監査ログを読み込めません",
        detail: error instanceof Error ? error.message : "unknown error",
      }, { status: 503 });
    }
  }

  if (payload.action === "session-end") {
    if (!payload.sessionId) return NextResponse.json({ message: "sessionIdが必要です" }, { status: 400 });
    try {
      await recorder.stopForSession(payload.sessionId);
      return NextResponse.json({ session: remoteAssist.end(payload.sessionId) });
    } catch (error) {
      return remoteSessionError(error);
    }
  }

  if (payload.action === "session-start") {
    if (!payload.serial) return NextResponse.json({ message: "端末を指定してください" }, { status: 400 });
    try {
      const { response, body } = await gatewayDevices();
      if (!response.ok) return NextResponse.json(body, { status: response.status });
      const device = (body.devices ?? []).find((item) => item.serial === payload.serial);
      if (!device) return NextResponse.json({ message: "許可されたRemote Gateway端末ではありません" }, { status: 404 });
      const capability = capabilityForRemoteDevice({
        canView: device.state === "device",
        canControl: device.state === "device",
      });
      if (!capability) return NextResponse.json({ message: "端末はRemote Assistを開始できる状態ではありません" }, { status: 409 });
      const session = remoteAssist.start({ serial: payload.serial, capability, ttlMs: payload.ttlMs });
      return NextResponse.json({ session });
    } catch (error) {
      return NextResponse.json({
        message: "Remote Assist sessionを開始できません",
        detail: error instanceof Error ? error.message : "unknown error",
      }, { status: 503 });
    }
  }

  if (payload.action === "recording-start") {
    try {
      const session = requireRecordingBinding(payload);
      const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
      const durationMs = Math.min(payload.durationMs ?? 30_000, Math.max(0, remainingMs - 1_000));
      if (durationMs < 2_000) throw new Error("Remote Assist sessionの残り時間が短いため記録を開始できません");
      const recording = recorder.start({
        sessionId: payload.sessionId!,
        serial: payload.serial!,
        durationMs,
        intervalMs: payload.intervalMs,
      });
      return NextResponse.json({ recording, format: "png-frame-sequence", videoStream: false }, { status: 202 });
    } catch (error) {
      return remoteSessionError(error);
    }
  }

  if (payload.action === "recording-status" || payload.action === "recording-stop") {
    if (!payload.recordingId) return NextResponse.json({ message: "recordingIdが必要です" }, { status: 400 });
    try {
      requireRecordingBinding(payload);
      const recording = payload.action === "recording-stop"
        ? await recorder.stop(payload.recordingId, payload.sessionId!, payload.serial!)
        : recorder.status(payload.recordingId, payload.sessionId!, payload.serial!);
      return NextResponse.json({ recording, format: "png-frame-sequence", videoStream: false });
    } catch (error) {
      return remoteSessionError(error);
    }
  }

  if (payload.action !== "qa-sequence-status" && !payload.serial) return NextResponse.json({ message: "端末を指定してください" }, { status: 400 });

  let manualAudit: { sessionId: string; serial: string; action: string } | undefined;
  if (isManualRemoteAction(payload.action)) {
    const sessionId = "sessionId" in payload ? payload.sessionId : undefined;
    if (!sessionId || !payload.serial) {
      return NextResponse.json({ message: "Remote Assist sessionを開始してください" }, { status: 409 });
    }
    try {
      const session = remoteAssist.requireActive(sessionId, payload.serial);
      if (!remoteCapabilityAllowsAction(session.capability, payload.action)) {
        return NextResponse.json({ message: "このRemote Assist sessionは画面閲覧のみです" }, { status: 403 });
      }
      remoteAssist.touch(sessionId, payload.serial);
      manualAudit = { sessionId, serial: payload.serial, action: payload.action };
    } catch (error) {
      return remoteSessionError(error);
    }
  }

  let path = "/api/remote/input";
  let body: Record<string, unknown> = { ...payload };
  delete body.sessionId;
  if (payload.action === "screenshot") {
    path = "/api/remote/screenshot";
    body = { serial: payload.serial };
  } else if (payload.action === "open-url") {
    if (!payload.url?.startsWith("https://")) return NextResponse.json({ message: "HTTPS URLを指定してください" }, { status: 400 });
    path = "/api/remote/open-url";
    body = { serial: payload.serial, url: payload.url };
  } else if (payload.action === "qa-sequence-start") {
    if (!payload.url1?.startsWith("https://") || !payload.url2?.startsWith("https://")) {
      return NextResponse.json({ message: "URL①とURL②はHTTPSで指定してください" }, { status: 400 });
    }
    if (!payload.packageName) return NextResponse.json({ message: "完了後に閉じるAndroidアプリのpackageNameが必要です" }, { status: 400 });
    path = "/api/remote/qa-sequence/start";
    body = {
      serial: payload.serial,
      url1: payload.url1,
      url2: payload.url2,
      packageName: payload.packageName,
      timeoutMs: payload.timeoutMs,
      pollMs: payload.pollMs,
    };
  } else if (payload.action === "qa-sequence-status") {
    if (!payload.runId) return NextResponse.json({ message: "runIdが必要です" }, { status: 400 });
    path = "/api/remote/qa-sequence/status";
    body = { runId: payload.runId };
  }

  try {
    const response = await jarvisRemoteGatewayFetch(path, { method: "POST", body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({ message: "Remote Gatewayから不正な応答を受信しました" }));
    if (manualAudit) {
      remoteAssist.recordAudit("action.forwarded", manualAudit.sessionId, manualAudit.serial, {
        action: manualAudit.action,
        outcome: response.ok ? "ok" : "error",
        httpStatus: response.status,
      });
    }
    if (payload.action === "screenshot" && "preview" in payload && payload.preview === true && response.ok && typeof result.imageBase64 === "string") {
      Object.assign(result, await remotePreview(result.imageBase64));
    }
    return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (manualAudit) {
      try {
        remoteAssist.recordAudit("action.forwarded", manualAudit.sessionId, manualAudit.serial, {
          action: manualAudit.action,
          outcome: "transport-error",
        });
      } catch {
        // The request already failed closed; do not replace the transport failure with audit cleanup noise.
      }
    }
    return NextResponse.json({
      message: "JARVIS Remote Gatewayに接続できません",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}
