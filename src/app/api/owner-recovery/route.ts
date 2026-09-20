import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../jarvis/broker.ts";

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const response = await jarvisBrokerFetch("/api/jarvis/admin/recovery");
  const body = await response.json().catch(() => ({ message: "復旧設定を取得できません" }));
  return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { action?: string; email?: string; code?: string } | null;
  const action = payload?.action;
  if (!["register-start", "register-verify"].includes(action || "")) return NextResponse.json({ message: "未対応の復旧設定操作です" }, { status: 400 });
  const response = await jarvisBrokerFetch("/api/jarvis/admin/recovery", {
    method: "POST",
    body: JSON.stringify({ action, email: payload?.email, code: payload?.code }),
  });
  const body = await response.json().catch(() => ({ message: "復旧設定を更新できません" }));
  return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
}
