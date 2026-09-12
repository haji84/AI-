import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/state");
    const body = await response.json().catch(() => ({ message: "JARVIS Brokerから不正な応答を受信しました" }));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      message: "JARVIS Brokerに接続できません",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}
