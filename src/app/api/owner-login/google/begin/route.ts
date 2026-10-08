import { NextResponse } from "next/server";
import { beginGoogleOwnerEnrollment } from "../../../../google-owner-service.ts";
import { issueGoogleOwnerContext } from "../../../../google-owner-state-client.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const enabled = process.env.GORIQ_GOOGLE_OWNER_ENROLLMENT_ENABLED === "1";
  const clientId = process.env.GORIQ_GOOGLE_OWNER_CLIENT_ID?.trim() || "";
  if (!enabled || !clientId) return NextResponse.json({ message: "Google Owner登録はまだ有効ではありません" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const result = await beginGoogleOwnerEnrollment({
      deviceId: String(payload?.deviceId ?? ""),
      publicKeyJwk: payload?.publicKeyJwk as JsonWebKey,
      state: String(payload?.state ?? ""),
      nonce: String(payload?.nonce ?? ""),
      pkceChallenge: String(payload?.pkceChallenge ?? ""),
    }, { enabled, clientId, issueContext: issueGoogleOwnerContext });
    return NextResponse.json({ ...result, redirectUri: "com.haji84.jarvis.iosowner:/oauth2redirect" }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const category = error instanceof Error && error.message === "invalid enrollment request" ? "request" : error instanceof Error && error.message === "invalid device key" ? "device-key" : "broker";
    console.error("GOOGLE_OWNER_BEGIN_FAILURE_CLASS", category);
    return NextResponse.json({ message: "Google Owner登録を開始できません" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
