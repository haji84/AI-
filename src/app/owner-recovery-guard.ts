import { cookies } from "next/headers";
import {
  OWNER_RECOVERY_RESTRICTED_COOKIE,
  verifyOwnerRecoveryRestrictionToken,
} from "./owner-auth.ts";

export async function ownerRecoveryRestricted(secret: string): Promise<boolean> {
  if (!secret.trim()) return false;
  const store = await cookies();
  return verifyOwnerRecoveryRestrictionToken(secret, store.get(OWNER_RECOVERY_RESTRICTED_COOKIE)?.value);
}
