import { cookies } from "next/headers";
import { OWNER_SESSION_COOKIE } from "../../../../../owner-auth.ts";
import { handleOwnerRecoveryCancel } from "../../../../../owner-recovery-http.ts";
import { cancelOwnerRecovery } from "../../../../../owner-recovery-registry-client.ts";
import { jarvisOwnerSecret, verifyFreshTrustedOwnerSessionAccess } from "../../../../jarvis/broker.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleOwnerRecoveryCancel(request, {
    enabled: process.env.GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1",
    ownerSecret: jarvisOwnerSecret(),
    sessionToken: async () => (await cookies()).get(OWNER_SESSION_COOKIE)?.value,
    verifyFreshSession: verifyFreshTrustedOwnerSessionAccess,
    cancel: cancelOwnerRecovery,
  });
}
