import { ownerSessionClaims } from "./owner-auth.ts";

export async function verifyFreshTrustedOwnerSessionAccess(
  secret: string,
  token: string | undefined,
  maxAgeSeconds: number,
  isRevoked: (deviceId: string) => Promise<unknown>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) return null;
  const claims = ownerSessionClaims(secret, token, { nowSeconds });
  if (!claims || nowSeconds - claims.issuedAtSeconds > maxAgeSeconds) return null;
  try { return (await isRevoked(claims.deviceId)) === false ? claims.deviceId : null; }
  catch { return null; }
}
