import { jarvisBrokerFetch } from "./api/jarvis/broker.ts";

type RecoveryDevice = { deviceId: string; label: string; revoked: boolean };

export class OwnerRecoveryBrokerError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("owner recovery registry unavailable");
    this.status = status;
  }
}

async function request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await jarvisBrokerFetch("/api/jarvis/admin/owner-recovery", {
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new OwnerRecoveryBrokerError(response.status);
  return await response.json() as Record<string, unknown>;
}

export async function issueOwnerRecovery(issuerDeviceId: string): Promise<{ code: string; expiresAt: number }> {
  const result = await request({ action: "issue", issuerDeviceId });
  if (typeof result.code !== "string" || typeof result.expiresAt !== "number" || !Number.isSafeInteger(result.expiresAt)) throw new OwnerRecoveryBrokerError(502);
  return { code: result.code, expiresAt: result.expiresAt };
}

export async function cancelOwnerRecovery(issuerDeviceId: string): Promise<{ cancelled: boolean }> {
  const result = await request({ action: "cancel", issuerDeviceId });
  if (typeof result.cancelled !== "boolean") throw new OwnerRecoveryBrokerError(502);
  return { cancelled: result.cancelled };
}

export async function redeemOwnerRecovery(input: {
  code: string;
  deviceId: string;
  label: string;
  publicKeyThumbprint: string;
  sourceBucket: string;
}): Promise<{ device: RecoveryDevice }> {
  const result = await request({ action: "redeem", ...input });
  const device = result.device as Partial<RecoveryDevice> | undefined;
  if (!device || typeof device.deviceId !== "string" || typeof device.label !== "string" || typeof device.revoked !== "boolean") throw new OwnerRecoveryBrokerError(502);
  return { device: { deviceId: device.deviceId, label: device.label, revoked: device.revoked } };
}
