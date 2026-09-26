import { createHmac } from "node:crypto";
import { publicKeyThumbprint } from "./google-owner-enrollment.ts";
import { createTrustedDeviceCredential } from "./trusted-device-auth.ts";
import { normalizeOwnerRecoveryCode } from "../jarvis/trusted-device-registry.ts";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;
const SOURCE_BUCKET = /^[A-Za-z0-9_-]{43}$/;

export async function issueOwnerRecoveryEnrollment(
  issuerDeviceId: string,
  issue: (issuerDeviceId: string) => Promise<{ code: string; expiresAt: number }>,
): Promise<{ code: string; expiresAt: number }> {
  if (!DEVICE_ID.test(issuerDeviceId)) throw new Error("invalid recovery issuer");
  return issue(issuerDeviceId);
}

export async function cancelOwnerRecoveryEnrollment(
  issuerDeviceId: string,
  cancel: (issuerDeviceId: string) => Promise<{ cancelled: boolean }>,
): Promise<{ cancelled: boolean }> {
  if (!DEVICE_ID.test(issuerDeviceId)) throw new Error("invalid recovery issuer");
  return cancel(issuerDeviceId);
}

type RedeemInput = { code: string; deviceId: string; label: string; publicKeyJwk: JsonWebKey; sourceBucket: string };
type Device = { deviceId: string; label: string; revoked: boolean };
type RedeemDependencies = {
  ownerSecret: string;
  createCredential?: typeof createTrustedDeviceCredential;
  redeem: (input: { code: string; deviceId: string; label: string; publicKeyThumbprint: string; sourceBucket: string }) => Promise<{ device: Device }>;
};

export async function redeemOwnerRecoveryEnrollment(input: RedeemInput, dependencies: RedeemDependencies): Promise<{ credential: string; device: Device }> {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  try {
    normalizeOwnerRecoveryCode(input.code);
    if (!DEVICE_ID.test(input.deviceId) || !label || label.length > 80 || !SOURCE_BUCKET.test(input.sourceBucket)) throw new Error("invalid");
    const thumbprint = publicKeyThumbprint(input.publicKeyJwk);
    const credential = (dependencies.createCredential ?? createTrustedDeviceCredential)(dependencies.ownerSecret, {
      deviceId: input.deviceId,
      label,
      publicKeyJwk: input.publicKeyJwk,
    });
    const result = await dependencies.redeem({
      code: input.code,
      deviceId: input.deviceId,
      label,
      publicKeyThumbprint: thumbprint,
      sourceBucket: input.sourceBucket,
    });
    return { credential, device: result.device };
  } catch (error) {
    if (error instanceof Error && ["owner recovery registry unavailable", "broker rejected"].includes(error.message)) throw error;
    throw new Error("invalid recovery enrollment");
  }
}

export function ownerRecoverySourceBucket(secret: string, sourceAddress: string | undefined): string {
  if (!secret.trim()) throw new Error("owner recovery unavailable");
  const source = sourceAddress?.trim() || "anonymous";
  return createHmac("sha256", secret).update(`owner-recovery-source:${source}`).digest("base64url");
}
