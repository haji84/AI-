import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  attachmentPathname,
  blobCredentialsReady,
  createPrivateBlobGetUrl,
  createPrivateBlobPutUrl,
  MAX_ATTACHMENT_SIZE_BYTES,
  normalizeAttachment,
  safeAttachmentName,
  type ChatAttachment,
} from "../../blob-presign.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

function attachmentOwnerReady(ownerSecret: string): boolean {
  return Boolean(ownerSecret && blobCredentialsReady());
}

async function requireOwner() {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  if (!attachmentOwnerReady(ownerSecret)) {
    return { error: NextResponse.json({ message: "添付ストレージが未設定です。private Vercel Blobを接続してください。" }, { status: 503 }) };
  }
  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return { error: NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 }) };
  }
  return { ownerSecret };
}

export async function GET() {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  return NextResponse.json({ ready: attachmentOwnerReady(ownerSecret), maxSizeBytes: MAX_ATTACHMENT_SIZE_BYTES }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await requireOwner();
  if ("error" in context) return context.error;

  const payload = await request.json().catch(() => null) as {
    action?: unknown;
    name?: unknown;
    contentType?: unknown;
    size?: unknown;
    pathname?: unknown;
  } | null;
  const action = payload?.action;

  if (action === "prepare") {
    const name = typeof payload?.name === "string" ? safeAttachmentName(payload.name) : "";
    const contentType = typeof payload?.contentType === "string" && payload.contentType.trim()
      ? payload.contentType.trim().slice(0, 160)
      : "application/octet-stream";
    const size = Number(payload?.size);
    if (!name) return NextResponse.json({ message: "ファイル名が不正です" }, { status: 400 });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_SIZE_BYTES) {
      return NextResponse.json({ message: `添付は1ファイル${Math.round(MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024)}MBまでです` }, { status: 400 });
    }
    const pathname = attachmentPathname(name);
    try {
      const signed = await createPrivateBlobPutUrl({ pathname, contentType, size });
      return NextResponse.json({
        pathname,
        uploadUrl: signed.uploadUrl,
        expiresAt: signed.expiresAt,
        uploadHeaders: {
          "x-vercel-blob-access": "private",
          "x-vercel-blob-store-id": signed.storeId,
          "x-api-version": "12",
          "x-content-type": contentType,
          "x-add-random-suffix": "0",
        },
      });
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "添付アップロード準備に失敗しました" }, { status: 502 });
    }
  }

  if (action === "authorize-read") {
    const name = typeof payload?.name === "string" ? safeAttachmentName(payload.name) : "";
    const contentType = typeof payload?.contentType === "string" && payload.contentType.trim()
      ? payload.contentType.trim().slice(0, 160)
      : "application/octet-stream";
    const pathname = typeof payload?.pathname === "string" ? payload.pathname.trim() : "";
    const size = Number(payload?.size);
    if (!name || !pathname.startsWith("ai-chat/") || !Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_SIZE_BYTES) {
      return NextResponse.json({ message: "添付情報が不正です" }, { status: 400 });
    }
    try {
      const signed = await createPrivateBlobGetUrl(pathname);
      const attachment: ChatAttachment = {
        name,
        contentType,
        size,
        pathname,
        readUrl: signed.readUrl,
        expiresAt: signed.expiresAt,
      };
      if (!normalizeAttachment(attachment)) throw new Error("署名済み添付情報の検証に失敗しました");
      return NextResponse.json({ attachment });
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "添付読取URLの発行に失敗しました" }, { status: 502 });
    }
  }

  return NextResponse.json({ message: "未対応の添付操作です" }, { status: 400 });
}
