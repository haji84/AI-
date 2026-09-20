import { NextResponse } from "next/server";
import { createTrustedDeviceCredential, revokedTrustedDeviceIds } from "../../../../trusted-device-auth.ts";
import { parseTrustedDeviceRecoveryGrant } from "../../../../trusted-device-recovery.ts";
import { jarvisOwnerSecret } from "../../../jarvis/broker.ts";

export async function POST(request: Request) {
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as { grant?: string } | null;
  const grant = typeof payload?.grant === "string" ? payload.grant : "";
  const authorized = parseTrustedDeviceRecoveryGrant(secret, grant);
  if (!authorized || revokedTrustedDeviceIds().has(authorized.deviceId)) {
    return NextResponse.json({ message: "復旧登録の承認情報を確認できません" }, { status: 401 });
  }
  try {
    const credential = createTrustedDeviceCredential(secret, {
      deviceId: authorized.deviceId,
      label: authorized.label,
      publicKeyJwk: authorized.publicKeyJwk,
    });
    return NextResponse.json({ ok: true, credential, deviceId: authorized.deviceId, label: authorized.label }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "信頼済み端末を復旧登録できませんでした" }, { status: 400 });
  }
}
