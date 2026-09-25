import { jarvisBrokerFetch } from "./api/jarvis/broker.ts";

async function request(path: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await jarvisBrokerFetch(`/api/jarvis/admin/trusted-devices${path}`, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("trusted device registry unavailable");
  return await response.json() as Record<string, unknown>;
}

export async function trustedDeviceIsRevoked(deviceId: string): Promise<boolean> {
  const result = await request(`?deviceId=${encodeURIComponent(deviceId)}`);
  if (typeof result.revoked !== "boolean") throw new Error("invalid trusted device registry response");
  return result.revoked;
}
export async function registerTrustedDevice(deviceId: string, label: string): Promise<void> {
  await request("", { action: "register", deviceId, label });
}
export async function revokeTrustedDevice(deviceId: string): Promise<void> {
  await request("", { action: "revoke", deviceId });
}
export async function listTrustedDevices(): Promise<Array<{ deviceId: string; label: string; revoked: boolean }>> {
  const result = await request("");
  if (!Array.isArray(result.devices) || result.devices.some(item => typeof item?.deviceId !== "string" || typeof item?.label !== "string" || typeof item?.revoked !== "boolean")) throw new Error("invalid trusted device registry response");
  return result.devices;
}
