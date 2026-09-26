import { NextResponse } from "next/server";
import { jarvisOwnerSecret } from "../../../../jarvis/broker.ts";
import { ownerRecoverySourceBucket, redeemOwnerRecoveryEnrollment } from "../../../../../owner-recovery-service.ts";
import { OwnerRecoveryBrokerError, redeemOwnerRecovery } from "../../../../../owner-recovery-registry-client.ts";

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
  if (!secret) return NextResponse.json({ message: "復旧コードで端末を登録できません" }, { status: 503, headers });
  let payload: Record<string, unknown>;
  try { payload = await boundedJson(request); }
  catch { return NextResponse.json({ message: "復旧コードで端末を登録できません" }, { status: 400, headers }); }
  const forwarded = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  try {
    const result = await redeemOwnerRecoveryEnrollment({
      code: String(payload.code ?? ""),
      deviceId: String(payload.deviceId ?? ""),
      label: String(payload.label ?? ""),
      publicKeyJwk: payload.publicKeyJwk as JsonWebKey,
      sourceBucket: ownerRecoverySourceBucket(secret, forwarded),
    }, { ownerSecret: secret, redeem: redeemOwnerRecovery });
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    const status = error instanceof OwnerRecoveryBrokerError && error.status !== 409 ? 503 : 403;
    return NextResponse.json({ message: "復旧コードで端末を登録できません" }, { status, headers });
  }
}
