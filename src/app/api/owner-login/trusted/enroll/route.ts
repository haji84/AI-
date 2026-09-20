import { NextResponse } from "next/server";
import { requireJarvisOwner, jarvisOwnerSecret } from "../../jarvis/broker.ts";
import { createTrustedDeviceCredential } from "../../../trusted-device-auth.ts";

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const credential = createTrustedDeviceCredential(secret, {
      deviceId: String(payload?.deviceId ?? ""),
      label: String(payload?.label ?? ""),
      publicKeyJwk: payload?.publicKeyJwk as JsonWebKey,
    });
    return NextResponse.json({ ok: true, credential }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "invalid trusted device" }, { status: 400 });
  }
}
