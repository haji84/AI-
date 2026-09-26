import { cookies } from "next/headers";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionBinding } from "../../owner-auth.ts";
import { verifyFreshTrustedOwnerSessionAccess as verifyFreshTrustedOwnerSession } from "../../fresh-trusted-owner-session.ts";

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

function validateJarvisEndpoint(base: string, name: string): void {
  if (!base.startsWith("http://127.0.0.1") && !base.startsWith("http://localhost") && !base.startsWith("https://")) {
    throw new Error(`${name} must be loopback HTTP or HTTPS`);
  }
}

async function authenticatedFetch(base: string, token: string, path: string, init?: RequestInit): Promise<Response> {
  if (!token) throw new Error("JARVIS service token is not configured");
  validateJarvisEndpoint(base, "JARVIS endpoint");
  return fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function jarvisBrokerFetch(path: string, init?: RequestInit): Promise<Response> {
  const configuredBase = process.env.JARVIS_BROKER_URL?.trim().replace(/\/$/, "") || "";
  if (!configuredBase && process.env.VERCEL) throw new Error("JARVIS_BROKER_URL is not configured for this Vercel deployment");
  const base = configuredBase || "http://127.0.0.1:8787";
  const token = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
  return authenticatedFetch(base, token, path, init);
}

export async function jarvisRemoteGatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const configuredBase = process.env.JARVIS_REMOTE_GATEWAY_URL?.trim().replace(/\/$/, "") || "";
  if (!configuredBase && process.env.VERCEL) throw new Error("JARVIS_REMOTE_GATEWAY_URL is not configured for this Vercel deployment");
  const base = configuredBase || "http://127.0.0.1:8790";
  const token = process.env.JARVIS_REMOTE_GATEWAY_TOKEN?.trim() || "";
  return authenticatedFetch(base, token, path, init);
}
