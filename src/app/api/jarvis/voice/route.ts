import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

async function authorized() {
  return await requireJarvisOwner();
}

export async function GET() {
  if (!await authorized()) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/voice", { method: "GET" });
    const body = await response.json().catch(() => ({ available: false, message: "音声エンジンの応答を読み取れません" }));
    return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      available: false,
      localOnly: true,
      paidFallback: false,
      message: error instanceof Error ? error.message : "ローカル音声エンジンへ接続できません",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  if (!await authorized()) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
    return NextResponse.json({ message: "読み上げる文字を入力してください" }, { status: 400 });
  }
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/voice", {
      method: "POST",
      body: JSON.stringify({
        text: payload.text.slice(0, 600),
        voiceId: typeof payload.voiceId === "string" ? payload.voiceId.slice(0, 120) : undefined,
        rate: typeof payload.rate === "number" ? payload.rate : undefined,
        pitch: typeof payload.pitch === "number" ? payload.pitch : undefined,
        volume: typeof payload.volume === "number" ? payload.volume : undefined,
      }),
    });
    const body = await response.json().catch(() => ({ message: "音声合成の応答を読み取れません" }));
    return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : "ローカル音声エンジンへ接続できません",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
