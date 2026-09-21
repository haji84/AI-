import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  OWNER_RECOVERY_RESTRICTED_COOKIE,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  parseOwnerRecoveryRestrictionUnlockAt,
} from "../../../owner-auth.ts";
import { jarvisOwnerSecret } from "../../jarvis/broker.ts";

const COMPLETION_WINDOW_SECONDS = 24 * 60 * 60;

export async function POST() {
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "復旧機能が設定されていません" }, { status: 503 });
  const store = await cookies();
  const proof = store.get(OWNER_RECOVERY_RESTRICTED_COOKIE)?.value;
  const unlockAt = parseOwnerRecoveryRestrictionUnlockAt(secret, proof);
  if (!unlockAt) return NextResponse.json({ message: "有効な復旧確認がありません" }, { status: 401 });

  const now = Math.floor(Date.now() / 1000);
  if (now < unlockAt) {
    return NextResponse.json({
      message: "復旧保護期間中です。時間経過後にもう一度実行してください。",
      recoveryLimited: true,
      unlockAt: new Date(unlockAt * 1000).toISOString(),
      remainingSeconds: unlockAt - now,
    }, { status: 423 });
  }
  if (now > unlockAt + COMPLETION_WINDOW_SECONDS) {
    store.delete(OWNER_RECOVERY_RESTRICTED_COOKIE);
    return NextResponse.json({ message: "復旧完了期限を過ぎました。新しい確認コードを取得してください。" }, { status: 410 });
  }

  store.set(OWNER_SESSION_COOKIE, createOwnerSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });
  store.delete(OWNER_RECOVERY_RESTRICTED_COOKIE);
  return NextResponse.json({ ok: true, message: "本人確認済みの復旧Sessionを開始しました。設定からこの端末のPINを再登録してください。" }, { headers: { "Cache-Control": "no-store" } });
}
