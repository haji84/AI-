import { jarvisBrokerFetch } from "./api/jarvis/broker.ts";

async function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await jarvisBrokerFetch("/api/jarvis/admin/google-owner", {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    console.error("GOOGLE_OWNER_STATE_HTTP_STATUS", response.status);
    throw new Error("google owner state unavailable");
  }
  return await response.json() as Record<string, unknown>;
}

export async function issueGoogleOwnerContext(input: { deviceId: string; publicKeyThumbprint: string; state: string; nonce: string; pkceChallenge: string }) {
  return await request({ action: "issueContext", ...input }) as { contextId: string; expiresAt: number };
}

export async function consumeGoogleOwnerContext(input: { contextId: string; deviceId: string; publicKeyThumbprint: string; state: string; nonce: string }) {
  return await request({ action: "consumeContext", ...input }) as { pkceChallenge: string };
}

export async function bindGoogleOwnerIdentity(input: { sub: string; email?: string; emailVerified: boolean; bootstrapEmail: string }) {
  return await request({ action: "bindIdentity", ...input }) as { sub: string; boundAt: number };
}

export async function googleOwnerIdentity() {
  return await request({ action: "identity" }) as { bound: boolean; sub?: string; boundAt?: number };
}
