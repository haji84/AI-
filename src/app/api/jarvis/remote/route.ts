import { NextResponse } from "next/server";
import { jarvisRemoteGatewayFetch, requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

type RemotePayload =
  | { action: "screenshot"; serial?: string }
  | { action: "tap"; serial?: string; x?: number; y?: number }
  | { action: "swipe"; serial?: string; x1?: number; y1?: number; x2?: number; y2?: number; durationMs?: number }
  | { action: "text"; serial?: string; text?: string }
  | { action: "keyevent"; serial?: string; key?: string }
  | { action: "open-url"; serial?: string; url?: string };

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try {
    const response = await jarvisRemoteGatewayFetch("/api/remote/devices");
    const body = await response.json().catch(() => ({ message: "Remote Gatewayから不正な応答を受信しました" }));
    return NextResponse.json(body, { status: response.status });
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
  if (!payload?.action || !payload.serial) return NextResponse.json({ message: "操作内容と端末を指定してください" }, { status: 400 });

  let path = "/api/remote/input";
  let body: Record<string, unknown> = { ...payload };
  if (payload.action === "screenshot") {
    path = "/api/remote/screenshot";
    body = { serial: payload.serial };
  } else if (payload.action === "open-url") {
    if (!payload.url?.startsWith("https://")) return NextResponse.json({ message: "HTTPS URLを指定してください" }, { status: 400 });
    path = "/api/remote/open-url";
    body = { serial: payload.serial, url: payload.url };
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
