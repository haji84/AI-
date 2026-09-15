import { NextResponse } from "next/server";
import {
  JarvisRemoteAssistSessionManager,
  capabilityForRemoteDevice,
  isManualRemoteAction,
} from "../../../../jarvis/remote-assist.ts";
import { jarvisRemoteGatewayFetch, requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

type RemotePayload =
  | { action: "session-start"; serial?: string; ttlMs?: number }
  | { action: "session-end"; sessionId?: string }
  | { action: "session-status"; sessionId?: string }
  | { action: "session-audit"; sessionId?: string }
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

const globalForRemoteAssist = globalThis as typeof globalThis & {
  __jarvisRemoteAssistSessions?: JarvisRemoteAssistSessionManager;
};
const remoteAssist = globalForRemoteAssist.__jarvisRemoteAssistSessions ?? new JarvisRemoteAssistSessionManager();
globalForRemoteAssist.__jarvisRemoteAssistSessions = remoteAssist;

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
    return NextResponse.json({ audit: remoteAssist.auditFor(payload.sessionId) });
  }

  if (payload.action === "session-end") {
    if (!payload.sessionId) return NextResponse.json({ message: "sessionIdが必要です" }, { status: 400 });
    try {
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

  if (payload.action !== "qa-sequence-status" && !payload.serial) return NextResponse.json({ message: "端末を指定してください" }, { status: 400 });

  if (isManualRemoteAction(payload.action)) {
    if (!payload.sessionId || !payload.serial) {
      return NextResponse.json({ message: "Remote Assist sessionを開始してください" }, { status: 409 });
    }
    try {
      remoteAssist.touch(payload.sessionId, payload.serial);
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
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      message: "JARVIS Remote Gatewayに接続できません",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}
