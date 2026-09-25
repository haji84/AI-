import { NextResponse } from "next/server";
import { jarvisOwnerSecret } from "../../../jarvis/broker.ts";
import { completeGoogleOwnerEnrollment } from "../../../../google-owner-service.ts";
import { exchangeGoogleAuthorizationCode, verifyGoogleIdToken } from "../../../../google-owner-oidc.ts";
import { bindGoogleOwnerIdentity, consumeGoogleOwnerContext } from "../../../../google-owner-state-client.ts";
import { createTrustedDeviceCredential } from "../../../../trusted-device-auth.ts";
import { registerTrustedDevice } from "../../../../trusted-device-registry-client.ts";

export const dynamic = "force-dynamic";

function configuredRedirectUri(clientId: string): string {
  const suffix = ".apps.googleusercontent.com";
  if (!clientId.endsWith(suffix)) throw new Error("invalid Google client id");
  const prefix = clientId.slice(0, -suffix.length);
  if (!/^[A-Za-z0-9-]+$/.test(prefix)) throw new Error("invalid Google client id");
  return `com.googleusercontent.apps.${prefix}:/oauth2redirect`;
}

export async function POST(request: Request) {
  const enabled = process.env.GORIQ_GOOGLE_OWNER_ENROLLMENT_ENABLED === "1";
  const clientId = process.env.GORIQ_GOOGLE_OWNER_CLIENT_ID?.trim() || "";
  const bootstrapEmail = process.env.GORIQ_GOOGLE_OWNER_BOOTSTRAP_EMAIL?.trim() || "";
  const secret = jarvisOwnerSecret();
  if (!enabled || !clientId || !bootstrapEmail || !secret) return NextResponse.json({ message: "Google Owner登録はまだ有効ではありません" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const result = await completeGoogleOwnerEnrollment({
      contextId: String(payload?.contextId ?? ""), deviceId: String(payload?.deviceId ?? ""),
      publicKeyJwk: payload?.publicKeyJwk as JsonWebKey, state: String(payload?.state ?? ""), nonce: String(payload?.nonce ?? ""),
      code: String(payload?.code ?? ""), codeVerifier: String(payload?.codeVerifier ?? ""), redirectUri: String(payload?.redirectUri ?? ""),
    }, {
      clientId, bootstrapEmail, redirectUri: OWNER_REDIRECT_URI,
      consumeContext: consumeGoogleOwnerContext,
      exchangeCode: exchangeGoogleAuthorizationCode,
      verifyIdToken: (token, input) => verifyGoogleIdToken(token, input),
      bindIdentity: bindGoogleOwnerIdentity,
      registerDevice: registerTrustedDevice,
      createCredential: input => createTrustedDeviceCredential(secret, input),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return NextResponse.json({ message: "Google Owner登録を完了できません" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
