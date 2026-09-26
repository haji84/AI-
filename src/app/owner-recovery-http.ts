import { OwnerRecoveryBrokerError } from "./owner-recovery-registry-client.ts";
import {
  cancelOwnerRecoveryEnrollment,
  issueOwnerRecoveryEnrollment,
  ownerRecoverySourceBucket,
  redeemOwnerRecoveryEnrollment,
} from "./owner-recovery-service.ts";

export const ownerRecoveryHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 4_096) throw new Error("invalid request");
  const value = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid request");
  return value as Record<string, unknown>;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: ownerRecoveryHeaders });
}

type TrustedRouteBase = {
  enabled: boolean;
  ownerSecret: string;
  sessionToken: () => Promise<string | undefined>;
  verifyFreshSession: (secret: string, token: string | undefined) => Promise<string | null>;
};

export async function handleOwnerRecoveryIssue(request: Request, dependencies: TrustedRouteBase & {
  issue: (issuerDeviceId: string) => Promise<{ code: string; expiresAt: number }>;
}): Promise<Response> {
  if (!dependencies.enabled) return json({ message: "Owner復旧登録はまだ有効ではありません" }, 503);
  if (!dependencies.ownerSecret) return json({ message: "復旧コードを発行できません" }, 503);
  try { await boundedJson(request); }
  catch { return json({ message: "復旧コードを発行できません" }, 400); }
  const issuerDeviceId = await dependencies.verifyFreshSession(dependencies.ownerSecret, await dependencies.sessionToken());
  if (!issuerDeviceId) return json({ message: "Face IDと端末鍵で再確認してください" }, 401);
  try { return json(await issueOwnerRecoveryEnrollment(issuerDeviceId, dependencies.issue), 200); }
  catch { return json({ message: "復旧コードを発行できません" }, 503); }
}

export async function handleOwnerRecoveryCancel(request: Request, dependencies: TrustedRouteBase & {
  cancel: (issuerDeviceId: string) => Promise<{ cancelled: boolean }>;
}): Promise<Response> {
  if (!dependencies.enabled) return json({ message: "Owner復旧登録はまだ有効ではありません" }, 503);
  if (!dependencies.ownerSecret) return json({ message: "復旧コードを取り消せません" }, 503);
  try { await boundedJson(request); }
  catch { return json({ message: "復旧コードを取り消せません" }, 400); }
  const issuerDeviceId = await dependencies.verifyFreshSession(dependencies.ownerSecret, await dependencies.sessionToken());
  if (!issuerDeviceId) return json({ message: "Face IDと端末鍵で再確認してください" }, 401);
  try { return json(await cancelOwnerRecoveryEnrollment(issuerDeviceId, dependencies.cancel), 200); }
  catch { return json({ message: "復旧コードを取り消せません" }, 503); }
}

export async function handleOwnerRecoveryRedeem(request: Request, dependencies: {
  enabled: boolean;
  ownerSecret: string;
  sourceAddress?: string;
  redeem: Parameters<typeof redeemOwnerRecoveryEnrollment>[1]["redeem"];
}): Promise<Response> {
  if (!dependencies.enabled) return json({ message: "Owner復旧登録はまだ有効ではありません" }, 503);
  if (!dependencies.ownerSecret) return json({ message: "復旧コードで端末を登録できません" }, 503);
  let payload: Record<string, unknown>;
  try { payload = await boundedJson(request); }
  catch { return json({ message: "復旧コードで端末を登録できません" }, 400); }
  try {
    const result = await redeemOwnerRecoveryEnrollment({
      code: String(payload.code ?? ""),
      deviceId: String(payload.deviceId ?? ""),
      label: String(payload.label ?? ""),
      publicKeyJwk: payload.publicKeyJwk as JsonWebKey,
      sourceBucket: ownerRecoverySourceBucket(dependencies.ownerSecret, dependencies.sourceAddress),
    }, { ownerSecret: dependencies.ownerSecret, redeem: dependencies.redeem });
    return json(result, 200);
  } catch (error) {
    const status = error instanceof OwnerRecoveryBrokerError && error.status !== 409 ? 503 : 403;
    return json({ message: "復旧コードで端末を登録できません" }, status);
  }
}
