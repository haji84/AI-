import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../../owner-auth.ts";
import {
  SECRET_OP_APPROVAL_COOKIE,
  SECRET_OP_TTL_SECONDS,
  createSecretOpApprovalToken,
} from "../../../secret-op-approval.ts";

export async function POST(request: Request) {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!ownerSecret) return NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 });

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (payload?.action !== "update_vercel_secret" || payload?.key !== "AI_COMPANY_GITHUB_TOKEN") {
    return NextResponse.json({ message: "このSecret操作は承認対象外です" }, { status: 400 });
  }

  const token = createSecretOpApprovalToken(ownerSecret, {
    action: "update_vercel_secret",
    key: "AI_COMPANY_GITHUB_TOKEN",
  });
  cookieStore.set(SECRET_OP_APPROVAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SECRET_OP_TTL_SECONDS,
  });

  return NextResponse.json({
    ok: true,
    action: "update_vercel_secret",
    key: "AI_COMPANY_GITHUB_TOKEN",
    expiresInSeconds: SECRET_OP_TTL_SECONDS,
  });
}
