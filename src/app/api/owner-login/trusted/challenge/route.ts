import { NextResponse } from "next/server";
import { jarvisOwnerSecret } from "../../jarvis/broker.ts";
import { createTrustedDeviceChallenge, parseTrustedDeviceCredential, revokedTrustedDeviceIds } from "../../../trusted-device-auth.ts";

export const TRUSTED_DEVICE_CHALLENGE_COOKIE = "jarvis_trusted_device_challenge";

export async function POST(request: Request) {
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const credentialToken = typeof payload?.credential === "string" ? payload.credential : "";
  const credential = parseTrustedDeviceCredential(secret, credentialToken);
  if (!credential || revokedTrustedDeviceIds().has(credential.deviceId)) {
    return NextResponse.json({ message: "この信頼済み端末は無効です" }, { status: 401 });
  }
  const issued = createTrustedDeviceChallenge(secret, credential.deviceId);
  const response = NextResponse.json({ token: issued.token, nonce: issued.challenge.nonce, expiresAt: issued.challenge.expiresAt }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(TRUSTED_DEVICE_CHALLENGE_COOKIE, issued.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 120,
  });
  return response;
}
