import { cookies } from "next/headers";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionBinding } from "../../owner-auth.ts";
import { verifyFreshTrustedOwnerSessionAccess as verifyFreshTrustedOwnerSession } from "../../fresh-trusted-owner-session.ts";
import { jarvisBrokerFetch } from "../../jarvis-broker-client.ts";

export { jarvisBrokerFetch, jarvisRemoteGatewayFetch } from "../../jarvis-broker-client.ts";

export function jarvisOwnerSecret(): string {
  return process.env.JARVIS_OWNER_SECRET?.trim() || process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
}

export async function requireJarvisOwner(): Promise<boolean> {
  const ownerSecret = jarvisOwnerSecret();
  if (!ownerSecret) return false;
  const cookieStore = await cookies();
  return verifyOwnerSessionAccess(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
}

export async function verifyOwnerSessionAccess(secret: string, token: string | undefined): Promise<boolean> {
  return verifyOwnerSessionBinding(secret, token, async (deviceId) => {
    const response = await jarvisBrokerFetch(`/api/jarvis/admin/trusted-devices?deviceId=${encodeURIComponent(deviceId)}`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error("trusted device registry unavailable");
    const status = await response.json() as { revoked?: unknown };
    return status.revoked;
  });
}

export async function verifyFreshTrustedOwnerSessionAccess(secret: string, token: string | undefined, maxAgeSeconds = 120): Promise<string | null> {
  return verifyFreshTrustedOwnerSession(secret, token, maxAgeSeconds, async (deviceId) => {
    const response = await jarvisBrokerFetch(`/api/jarvis/admin/trusted-devices?deviceId=${encodeURIComponent(deviceId)}`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error("trusted device registry unavailable");
    const status = await response.json() as { revoked?: unknown };
    return status.revoked;
  });
}
