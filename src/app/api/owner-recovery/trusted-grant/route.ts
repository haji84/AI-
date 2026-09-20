import { NextResponse } from "next/server";
import { jarvisOwnerSecret, requireJarvisOwner } from "../../jarvis/broker.ts";
import {
  createTrustedDeviceRecoveryGrant,
  parseTrustedDeviceRecoveryRequest,
} from "../../../trusted-device-recovery.ts";

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "JARVIS owner login is not configured" }, { status: 503 });
  const payload = await request.json().catch(() => null) as { requestCode?: string } | null;
  const requestCode = typeof payload?.requestCode === "string" ? payload.requestCode : "";
  const recoveryRequest = parseTrustedDeviceRecoveryRequest(secret, requestCode);
  if (!recoveryRequest) {
    return NextResponse.json({ message: "復旧対象ブラウザの要求コードを確認できません" }, { status: 400 });
  }
  try {
    const authorized = createTrustedDeviceRecoveryGrant(secret, recoveryRequest);
    return NextResponse.json({
      ok: true,
      grant: authorized.grant,
      expiresAt: new Date(authorized.expiresAt * 1000).toISOString(),
      target: { deviceId: recoveryRequest.deviceId, label: recoveryRequest.label },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "復旧登録を承認できませんでした" }, { status: 400 });
  }
}
