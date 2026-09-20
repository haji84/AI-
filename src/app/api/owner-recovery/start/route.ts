import { NextResponse } from "next/server";
import { jarvisBrokerFetch } from "../jarvis/broker.ts";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { email?: string } | null;
  const email = typeof payload?.email === "string" ? payload.email : "";
  try {
    await jarvisBrokerFetch("/api/jarvis/admin/recovery", {
      method: "POST",
      body: JSON.stringify({ action: "recover-start", email }),
    });
  } catch {
    // Do not reveal whether a recovery address exists.
  }
  return NextResponse.json({ accepted: true, message: "登録済みの場合は復旧メールを送信します。" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
