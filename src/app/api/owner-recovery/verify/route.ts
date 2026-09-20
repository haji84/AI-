import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createOwnerRecoveryRestrictionToken,
  OWNER_RECOVERY_RESTRICTED_COOKIE,
} from "../../owner-auth.ts";
import { jarvisBrokerFetch, jarvisOwnerSecret } from "../jarvis/broker.ts";

export async function POST(request: Request) {
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "復旧機能が設定されていません" }, { status: 503 });
  const payload = await request.json().catch(() => null) as { code?: string } | null;
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ message: "6桁の確認コードを入力してください" }, { status: 400 });

  const response = await jarvisBrokerFetch("/api/jarvis/admin/recovery", {
    method: "POST",
    body: JSON.stringify({ action: "recover-verify", code }),
  });
  const body = await response.json().catch(() => null) as { restrictedUntil?: string; message?: string } | null;
  if (!response.ok || !body?.restrictedUntil) return NextResponse.json({ message: body?.message || "復旧コードを確認できませんでした" }, { status: response.status || 401 });

  const untilSeconds = Math.floor(Date.parse(body.restrictedUntil) / 1000);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cookieStore = await cookies();
  cookieStore.set(OWNER_RECOVERY_RESTRICTED_COOKIE, createOwnerRecoveryRestrictionToken(secret, untilSeconds), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: Math.max(1, untilSeconds - nowSeconds),
  });
  return NextResponse.json({ ok: true, recoveryLimited: true, restrictedUntil: body.restrictedUntil }, { headers: { "Cache-Control": "no-store" } });
}
