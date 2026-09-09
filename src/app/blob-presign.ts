const BLOB_API_BASE = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

export const MAX_ATTACHMENT_SIZE_BYTES = 512 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 6;
export const PUT_URL_TTL_MS = 15 * 60 * 1000;
export const GET_URL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChatAttachment {
  name: string;
  contentType: string;
  size: number;
  pathname: string;
  readUrl: string;
  expiresAt: string;
}

type DelegationOperation = "get" | "put";

type SignedTokenResponse = {
  delegationToken: string;
  clientSigningToken: string;
  validUntil: number;
};

type BlobCredentials = { token: string; storeId: string };

function base64Url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeStoreId(storeId: string): string {
  return storeId.startsWith("store_") ? storeId.slice("store_".length) : storeId;
}

export function parseBlobStoreId(token: string): string {
  const [, , , storeId = ""] = token.split("_");
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKENからstore IDを取得できません");
  return normalizeStoreId(storeId);
}

export function blobCredentialsReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const readWrite = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (readWrite) return true;
  return Boolean(env.VERCEL_OIDC_TOKEN?.trim() && env.BLOB_STORE_ID?.trim());
}

function blobCredentials(): BlobCredentials {
  const readWrite = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
  if (readWrite) return { token: readWrite, storeId: parseBlobStoreId(readWrite) };

  const oidc = process.env.VERCEL_OIDC_TOKEN?.trim() || "";
  const storeId = process.env.BLOB_STORE_ID?.trim() || "";
  if (oidc && storeId) return { token: oidc, storeId: normalizeStoreId(storeId) };

  throw new Error("private Vercel Blobが未接続です");
}

function canonicalString(operation: DelegationOperation, pathname: string): string {
  return [`operation=${operation}`, `pathname=${pathname}`].sort().join("\n");
}

async function hmacSha256Base64Url(key: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

async function issueSignedToken(input: {
  pathname: string;
  operation: DelegationOperation;
  validUntil: number;
  contentType?: string;
  maximumSizeInBytes?: number;
}): Promise<{ token: SignedTokenResponse; storeId: string }> {
  const credentials = blobCredentials();
  const response = await fetch(`${BLOB_API_BASE}/signed-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-store-id": credentials.storeId,
    },
    body: JSON.stringify({
      pathname: input.pathname,
      operations: [input.operation],
      validUntil: input.validUntil,
      ...(input.contentType ? { allowedContentTypes: [input.contentType] } : {}),
      ...(input.maximumSizeInBytes ? { maximumSizeInBytes: input.maximumSizeInBytes } : {}),
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as Partial<SignedTokenResponse> & { error?: { message?: string }; message?: string } | null;
  if (!response.ok || !payload?.delegationToken || !payload.clientSigningToken || typeof payload.validUntil !== "number") {
    throw new Error(payload?.error?.message || payload?.message || `Vercel Blob signed-token failed (${response.status})`);
  }
  return { token: payload as SignedTokenResponse, storeId: credentials.storeId };
}

function addSignedParams(url: string, delegationToken: string, signature: string): string {
  const target = new URL(url);
  target.searchParams.set("vercel-blob-delegation", delegationToken);
  target.searchParams.set("vercel-blob-signature", signature);
  return target.toString();
}

export function safeAttachmentName(name: string): string {
  const normalized = name.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]+/g, "_").trim();
  return (normalized || "attachment").slice(0, 160);
}

export function attachmentPathname(name: string): string {
  return `ai-chat/${Date.now()}-${crypto.randomUUID()}-${safeAttachmentName(name)}`;
}

export async function createPrivateBlobPutUrl(input: {
  pathname: string;
  contentType: string;
  size: number;
}) {
  const validUntil = Date.now() + PUT_URL_TTL_MS;
  const { token, storeId } = await issueSignedToken({
    pathname: input.pathname,
    operation: "put",
    validUntil,
    contentType: input.contentType,
    maximumSizeInBytes: input.size,
  });
  const signature = await hmacSha256Base64Url(token.clientSigningToken, canonicalString("put", input.pathname));
  const base = new URL(`${BLOB_API_BASE}/`);
  base.searchParams.set("pathname", input.pathname);
  return {
    uploadUrl: addSignedParams(base.toString(), token.delegationToken, signature),
    storeId,
    expiresAt: new Date(token.validUntil).toISOString(),
  };
}

export async function createPrivateBlobGetUrl(pathname: string) {
  const validUntil = Date.now() + GET_URL_TTL_MS;
  const { token, storeId } = await issueSignedToken({ pathname, operation: "get", validUntil });
  const signature = await hmacSha256Base64Url(token.clientSigningToken, canonicalString("get", pathname));
  const target = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`;
  return {
    readUrl: addSignedParams(target, token.delegationToken, signature),
    expiresAt: new Date(token.validUntil).toISOString(),
  };
}

export function normalizeAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatAttachment>;
  const name = typeof item.name === "string" ? safeAttachmentName(item.name) : "";
  const contentType = typeof item.contentType === "string" && item.contentType.trim() ? item.contentType.trim().slice(0, 160) : "application/octet-stream";
  const pathname = typeof item.pathname === "string" ? item.pathname.trim() : "";
  const readUrl = typeof item.readUrl === "string" ? item.readUrl.trim() : "";
  const expiresAt = typeof item.expiresAt === "string" ? item.expiresAt.trim() : "";
  const size = Number(item.size);
  if (!name || !pathname.startsWith("ai-chat/") || !Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_SIZE_BYTES) return null;
  if (!readUrl.startsWith("https://") || !readUrl.includes(".private.blob.vercel-storage.com/")) return null;
  if (!Number.isFinite(Date.parse(expiresAt))) return null;
  return { name, contentType, size, pathname, readUrl, expiresAt };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
