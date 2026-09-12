import { cookies } from "next/headers";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

export async function requireJarvisOwner(): Promise<boolean> {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!ownerSecret) return false;
  const cookieStore = await cookies();
  return verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
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
  const base = process.env.JARVIS_BROKER_URL?.trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
  const token = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
  return authenticatedFetch(base, token, path, init);
}

export async function jarvisRemoteGatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.JARVIS_REMOTE_GATEWAY_URL?.trim().replace(/\/$/, "") || "http://127.0.0.1:8790";
  const token = process.env.JARVIS_REMOTE_GATEWAY_TOKEN?.trim() || "";
  return authenticatedFetch(base, token, path, init);
}
