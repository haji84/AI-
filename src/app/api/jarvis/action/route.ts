import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

type JarvisDashboardAction =
  | { action: "enrollment"; mode?: "quick" | "full" | "fleet"; maxDevices?: number; group?: string }
  | { action: "open-url"; url?: string; targetNodeId?: string; allowJavaScript?: boolean }
  | { action: "resolve-takeover"; sessionId?: string; resumeTask?: boolean };

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as JarvisDashboardAction | null;
  if (!payload?.action) return NextResponse.json({ message: "操作内容がありません" }, { status: 400 });

  let path: string;
  let body: Record<string, unknown>;
  if (payload.action === "enrollment") {
    path = "/api/jarvis/admin/enrollment";
    body = {
      mode: payload.mode ?? "quick",
      maxDevices: payload.maxDevices ?? (payload.mode === "fleet" ? 100 : 1),
      group: payload.group,
    };
  } else if (payload.action === "open-url") {
    if (!payload.url?.startsWith("https://")) return NextResponse.json({ message: "HTTPS URLを指定してください" }, { status: 400 });
    path = "/api/jarvis/admin/tasks";
    body = {
      type: "open-url",
      payload: { url: payload.url, allowJavaScript: payload.allowJavaScript === true },
      targetNodeId: payload.targetNodeId || undefined,
    };
  } else {
    if (!payload.sessionId) return NextResponse.json({ message: "Takeover session IDが必要です" }, { status: 400 });
    path = "/api/jarvis/admin/takeover/resolve";
    body = { sessionId: payload.sessionId, resumeTask: payload.resumeTask !== false };
  }

  try {
    const response = await jarvisBrokerFetch(path, { method: "POST", body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({ message: "JARVIS Brokerから不正な応答を受信しました" }));
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({
      message: payload.action === "enrollment" ? "登録URLを発行できません。JARVIS Brokerの接続設定を確認してください。" : "JARVIS Brokerに接続できません",
      detail,
    }, { status: 503 });
  }
}
