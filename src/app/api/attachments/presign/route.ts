import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAttachmentUploadGrant, validateAttachmentDescriptor } from "../../../attachment-storage.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../../owner-auth.ts";

export async function POST(request: Request) {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
  if (!ownerSecret || !blobToken) {
    return NextResponse.json({ message: "添付ストレージはまだ有効化されていません" }, { status: 503 });
  }

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const descriptor = validateAttachmentDescriptor(payload);
  if (!descriptor) {
    return NextResponse.json({ message: "このファイル形式またはサイズは添付できません" }, { status: 400 });
  }

  try {
    const grant = await createAttachmentUploadGrant(descriptor, blobToken);
    return NextResponse.json(grant, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "添付用の安全なアップロードURLを作れませんでした" }, { status: 502 });
  }
}
