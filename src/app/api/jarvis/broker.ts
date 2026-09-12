import { cookies } from "next/headers";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

export async function requireJarvisOwner(): Promise<boolean> {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!ownerSecret) return false;
  const cookieStore = await cookies();
  return verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
}

export async function jarvisBrokerFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.JARVIS_BROKER_URL?.trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
  const token = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
  if (!token) throw new Error("JARVIS_OWNER_TOKEN is not configured");
  if (!base.startsWith("http://127.0.0.1") && !base.startsWith("http://localhost") && !base.startsWith("https://")) {
    throw new Error("JARVIS_BROKER_URL must be loopback HTTP or HTTPS");
  }
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
