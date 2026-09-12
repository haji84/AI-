import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";
import {
  SECRET_OP_APPROVAL_COOKIE,
  verifySecretOpApprovalToken,
} from "../../secret-op-approval.ts";
import {
  getLatestDeploymentDiagnostics,
  getVercelOwnerStatus,
  isManagedSecretKey,
  redeployLatestProduction,
  updateManagedSecret,
  vercelOwnerConfigFromEnv,
} from "../../vercel-owner.ts";

async function ownerGate() {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!ownerSecret) return NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 });
  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }
  return null;
}

function configOrError() {
  const config = vercelOwnerConfigFromEnv();
  if (!config) {
    return {
      error: NextResponse.json({
        configured: false,
        message: "Vercel管理機能のserver-side設定が不足しています",
      }, { status: 503 }),
    } as const;
  }
  return { config } as const;
}

export async function GET() {
  const gate = await ownerGate();
  if (gate) return gate;
  const context = configOrError();
  if ("error" in context) return context.error;
  try {
    const status = await getVercelOwnerStatus(context.config);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Vercel状態確認に失敗しました" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const gate = await ownerGate();
  if (gate) return gate;
  const context = configOrError();
  if ("error" in context) return context.error;

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof payload?.action === "string" ? payload.action : "";

  try {
    if (action === "status") {
      return NextResponse.json(await getVercelOwnerStatus(context.config));
    }
    if (action === "diagnostics") {
      return NextResponse.json(await getLatestDeploymentDiagnostics(context.config));
    }
    if (action === "redeploy_production") {
      return NextResponse.json({ ok: true, deployment: await redeployLatestProduction(context.config) });
    }
    if (action === "update_secret") {
      const key = payload?.key;
      const value = typeof payload?.value === "string" ? payload.value : "";
      if (!isManagedSecretKey(key)) {
        return NextResponse.json({ message: "この環境変数はAI会社の管理対象外です" }, { status: 400 });
      }
      if (!value.trim()) {
        return NextResponse.json({ message: "Secret値を入力してください" }, { status: 400 });
      }

      const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
      const cookieStore = await cookies();
      const approved = verifySecretOpApprovalToken(
        ownerSecret,
        cookieStore.get(SECRET_OP_APPROVAL_COOKIE)?.value,
        { action: "update_vercel_secret", key },
      );
      if (!approved) {
        return NextResponse.json({
          message: "Secret操作は1回限りHuman Gateの承認が必要です",
          humanGateRequired: true,
        }, { status: 403 });
      }

      // Consume the approval before invoking the external mutation. The browser loses
      // the capability even if the downstream call fails, so retry requires a fresh approval.
      cookieStore.delete(SECRET_OP_APPROVAL_COOKIE);

      const result = await updateManagedSecret(context.config, key, value);
      const redeploy = payload?.redeploy === true;
      const deployment = redeploy ? await redeployLatestProduction(context.config) : null;
      return NextResponse.json({ ok: true, result, deployment, approvalConsumed: true });
    }
    return NextResponse.json({ message: "未対応のVercel管理操作です" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Vercel管理操作に失敗しました" }, { status: 502 });
  }
}
