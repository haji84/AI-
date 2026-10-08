import { jarvisOwnerSecret } from "../../../../jarvis/broker.ts";
import { handleOwnerRecoveryRedeem } from "../../../../../owner-recovery-http.ts";
import { redeemOwnerRecovery } from "../../../../../owner-recovery-registry-client.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const forwarded = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return handleOwnerRecoveryRedeem(request, {
    enabled: process.env.GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1",
    ownerSecret: jarvisOwnerSecret(),
    sourceAddress: forwarded,
    redeem: redeemOwnerRecovery,
  });
}
