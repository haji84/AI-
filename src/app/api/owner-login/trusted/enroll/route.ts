import { NextResponse } from "next/server";
import { requireJarvisOwner, jarvisOwnerSecret } from "../../../jarvis/broker.ts";
import { createTrustedDeviceCredential } from "../../../../trusted-device-auth.ts";
import { registerTrustedDevice } from "../../../../trusted-device-registry-client.ts";

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const input = {
      deviceId: String(payload?.deviceId ?? ""),
      label: String(payload?.label ?? ""),
      publicKeyJwk: payload?.publicKeyJwk as JsonWebKey,
    };
    const credential = createTrustedDeviceCredential(secret, input);
    await registerTrustedDevice(input.deviceId, input.label);
    return NextResponse.json({ ok: true, credential }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "信頼済み端末を登録できませんでした" }, { status: 503 });
  }
}
