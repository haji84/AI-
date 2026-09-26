import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "../../../../../owner-auth.ts";
import { issueOwnerRecoveryEnrollment } from "../../../../../owner-recovery-service.ts";
import { issueOwnerRecovery } from "../../../../../owner-recovery-registry-client.ts";
import { jarvisOwnerSecret, verifyFreshTrustedOwnerSessionAccess } from "../../../../jarvis/broker.ts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 4_096) throw new Error("invalid request");
  const value = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid request");
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const enabled = process.env.GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1";
  if (!enabled) return NextResponse.json({ message: "Owner復旧登録はまだ有効ではありません" }, { status: 503, headers });
  const secret = jarvisOwnerSecret();
  if (!secret) return NextResponse.json({ message: "復旧コードを発行できません" }, { status: 503, headers });
  try { await boundedJson(request); }
  catch { return NextResponse.json({ message: "復旧コードを発行できません" }, { status: 400, headers }); }
  const cookieStore = await cookies();
  const issuerDeviceId = await verifyFreshTrustedOwnerSessionAccess(secret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
  if (!issuerDeviceId) return NextResponse.json({ message: "Face IDと端末鍵で再確認してください" }, { status: 401, headers });
  try {
    return NextResponse.json(await issueOwnerRecoveryEnrollment(issuerDeviceId, issueOwnerRecovery), { status: 200, headers });
  } catch {
    return NextResponse.json({ message: "復旧コードを発行できません" }, { status: 503, headers });
  }
}
