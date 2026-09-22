import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { text?: unknown; idempotencyKey?: unknown } | null;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) return NextResponse.json({ message: "仕事の内容を入力してください" }, { status: 400 });
  const idempotencyKey = typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey.trim() : undefined;
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/work", {
      method: "POST",
      body: JSON.stringify({ text, ...(idempotencyKey ? { idempotencyKey } : {}) }),
    });
    const body = await response.json().catch(() => ({ message: "JARVISから不正な応答を受信しました" }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json({ message: "JARVIS Runtimeに接続できません", detail: error instanceof Error ? error.message : "unknown error" }, { status: 503 });
  }
}
