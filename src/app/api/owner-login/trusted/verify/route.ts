import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createOwnerSessionToken, OWNER_SESSION_COOKIE, OWNER_SESSION_MAX_AGE_SECONDS } from "../../../../owner-auth.ts";
import { jarvisOwnerSecret } from "../../../jarvis/broker.ts";
import { parseTrustedDeviceChallenge, parseTrustedDeviceCredential, revokedTrustedDeviceIds, verifyTrustedDeviceProof } from "../../../../trusted-device-auth.ts";
import { TRUSTED_DEVICE_CHALLENGE_COOKIE } from "../challenge/route.ts";
import { registerTrustedDevice, trustedDeviceIsRevoked } from "../../../../trusted-device-registry-client.ts";

export async function POST(request: Request) {
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const credentialToken = typeof payload?.credential === "string" ? payload.credential : "";
  const challengeToken = typeof payload?.challengeToken === "string" ? payload.challengeToken : "";
  const signatureBase64Url = typeof payload?.signatureBase64Url === "string" ? payload.signatureBase64Url : "";
  const credential = parseTrustedDeviceCredential(secret, credentialToken);
  const challenge = parseTrustedDeviceChallenge(secret, challengeToken);
  const cookieStore = await cookies();
  const cookieChallenge = cookieStore.get(TRUSTED_DEVICE_CHALLENGE_COOKIE)?.value;
  cookieStore.delete(TRUSTED_DEVICE_CHALLENGE_COOKIE);
  if (!credential || !challenge || cookieChallenge !== challengeToken || revokedTrustedDeviceIds().has(credential.deviceId)) {
    return NextResponse.json({ message: "信頼済み端末の確認に失敗しました" }, { status: 401 });
  }
  try {
    if (await trustedDeviceIsRevoked(credential.deviceId)) return NextResponse.json({ message: "この信頼済み端末は失効しています" }, { status: 401 });
  } catch { return NextResponse.json({ message: "端末の失効状態を確認できません" }, { status: 503 }); }
  if (!verifyTrustedDeviceProof({ credential, challenge, signatureBase64Url })) {
    return NextResponse.json({ message: "端末鍵の署名を確認できませんでした" }, { status: 401 });
  }
  try { await registerTrustedDevice(credential.deviceId, credential.label); }
  catch { return NextResponse.json({ message: "端末の登録状態を確認できません" }, { status: 503 }); }
  const response = NextResponse.json({ ok: true, deviceId: credential.deviceId }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(OWNER_SESSION_COOKIE, createOwnerSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
