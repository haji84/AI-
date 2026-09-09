import { createHmac, randomUUID } from "node:crypto";

export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 ** 4;
export const ATTACHMENT_READ_TTL_MS = 60 * 60 * 1000;
export const ATTACHMENT_UPLOAD_TTL_MS = 15 * 60 * 1000;

const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";
const ALLOWED_EXACT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
]);
const EXTENSION_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
};

type DelegationOperation = "get" | "put";

type IssuedSignedToken = {
  delegationToken: string;
  clientSigningToken: string;
  validUntil: number;
};

type DelegationPayload = {
  storeId: string;
  pathname: string;
  operations: string[];
  validUntil: number;
};

export type AttachmentDescriptor = {
  name: string;
  type: string;
  size: number;
};

export type UploadedAttachmentRef = AttachmentDescriptor & {
  pathname: string;
  readUrl: string;
  expiresAt: string;
};

export function inferAttachmentType(name: string, contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  const lowerName = name.trim().toLowerCase();
  const extension = Object.keys(EXTENSION_TYPES).find((item) => lowerName.endsWith(item));
  return extension ? EXTENSION_TYPES[extension] : normalized;
}

export function isAllowedAttachmentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase();
  return normalized.startsWith("image/") || normalized.startsWith("video/") || normalized.startsWith("text/") || ALLOWED_EXACT_TYPES.has(normalized);
}

export function validateAttachmentDescriptor(value: unknown): AttachmentDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<AttachmentDescriptor>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const suppliedType = typeof input.type === "string" ? input.type : "";
  const type = inferAttachmentType(name, suppliedType);
  const size = typeof input.size === "number" ? input.size : Number.NaN;
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name) || !type || type.length > 160) return null;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_SIZE_BYTES) return null;
  if (!isAllowedAttachmentType(type)) return null;
  return { name, type, size };
}

export function createAttachmentPathname(name: string, now = new Date()): string {
  const safeName = name
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-100) || "attachment";
  const month = now.toISOString().slice(0, 7);
  return `ai-chat/${month}/${randomUUID()}-${safeName}`;
}

function parseStoreIdFromReadWriteToken(token: string): string {
  const [, , , storeId = ""] = token.split("_");
  if (!storeId) throw new Error("Blob storage is not configured");
  return storeId.startsWith("store_") ? storeId.slice("store_".length) : storeId;
}

function decodeDelegation(token: string): DelegationPayload {
  const dot = token.indexOf(".");
  if (dot < 1) throw new Error("Blob signing response is invalid");
  const parsed = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8")) as Partial<DelegationPayload>;
  if (!parsed.storeId || !parsed.pathname || !Array.isArray(parsed.operations) || typeof parsed.validUntil !== "number") {
    throw new Error("Blob signing response is invalid");
  }
  return parsed as DelegationPayload;
}

function canonicalString(pathname: string, operation: DelegationOperation, entries: Array<[string, string]>): string {
  const lines = [`operation=${operation}`, `pathname=${pathname}`, ...entries.map(([key, value]) => `${key}=${value}`)];
  return lines.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))).join("\n");
}

function signPresignedUrl(token: IssuedSignedToken, operation: DelegationOperation, pathname: string, validUntil: number, constraints?: { allowedContentTypes?: string[]; maximumSizeInBytes?: number }): string {
  const scope = decodeDelegation(token.delegationToken);
  if (scope.pathname !== pathname || !scope.operations.includes(operation)) throw new Error("Blob signing scope mismatch");
  if (Date.now() >= scope.validUntil || validUntil > scope.validUntil) throw new Error("Blob signing scope expired");

  const entries: Array<[string, string]> = [];
  if (validUntil < scope.validUntil) entries.push(["vercel-blob-valid-until", String(validUntil)]);
  if (operation === "put") {
    const allowed = constraints?.allowedContentTypes?.slice().sort();
    if (allowed?.length) entries.push(["vercel-blob-allowed-content-types", allowed.join(",")]);
    if (constraints?.maximumSizeInBytes !== undefined) entries.push(["vercel-blob-maximum-size-in-bytes", String(constraints.maximumSizeInBytes)]);
    entries.push(["vercel-blob-add-random-suffix", "false"]);
    entries.push(["vercel-blob-allow-overwrite", "false"]);
  }

  const canonical = canonicalString(pathname, operation, entries);
  const signature = createHmac("sha256", token.clientSigningToken).update(canonical).digest("base64url");
  const storeId = scope.storeId.toLowerCase().replace(/^store_/, "");
  const url = operation === "get"
    ? new URL(`https://${storeId}.private.blob.vercel-storage.com/${pathname}`)
    : new URL(`${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`);
  for (const [key, value] of entries) url.searchParams.set(key, value);
  url.searchParams.set("vercel-blob-delegation", token.delegationToken);
  url.searchParams.set("vercel-blob-signature", signature);
  return url.toString();
}

async function issueSignedToken(readWriteToken: string, pathname: string, descriptor: AttachmentDescriptor, fetchImpl: typeof fetch): Promise<IssuedSignedToken> {
  const storeId = parseStoreIdFromReadWriteToken(readWriteToken);
  const validUntil = Date.now() + ATTACHMENT_READ_TTL_MS;
  const response = await fetchImpl(`${BLOB_API_URL}/signed-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readWriteToken}`,
      "Content-Type": "application/json",
      "x-api-version": BLOB_API_VERSION,
      "x-api-blob-request-attempt": "0",
      "x-api-blob-request-id": `ai-chat:${Date.now()}:${randomUUID()}`,
      "x-vercel-blob-store-id": storeId,
    },
    body: JSON.stringify({
      pathname,
      operations: ["put", "get"],
      validUntil,
      allowedContentTypes: [descriptor.type],
      maximumSizeInBytes: descriptor.size,
    }),
  });
  if (!response.ok) throw new Error("Private Blob signing failed");
  const payload = await response.json().catch(() => null) as Partial<IssuedSignedToken> | null;
  if (!payload?.delegationToken || !payload.clientSigningToken || typeof payload.validUntil !== "number") {
    throw new Error("Private Blob signing failed");
  }
  return payload as IssuedSignedToken;
}

export async function createAttachmentUploadGrant(descriptor: AttachmentDescriptor, readWriteToken: string, fetchImpl: typeof fetch = fetch): Promise<{ uploadUrl: string; attachment: UploadedAttachmentRef }> {
  if (!readWriteToken.trim()) throw new Error("Blob storage is not configured");
  const pathname = createAttachmentPathname(descriptor.name);
  const signedToken = await issueSignedToken(readWriteToken, pathname, descriptor, fetchImpl);
  const uploadValidUntil = Math.min(Date.now() + ATTACHMENT_UPLOAD_TTL_MS, signedToken.validUntil - 1);
  const uploadUrl = signPresignedUrl(signedToken, "put", pathname, uploadValidUntil, {
    allowedContentTypes: [descriptor.type],
    maximumSizeInBytes: descriptor.size,
  });
  const readUrl = signPresignedUrl(signedToken, "get", pathname, signedToken.validUntil);
  return {
    uploadUrl,
    attachment: {
      ...descriptor,
      pathname,
      readUrl,
      expiresAt: new Date(signedToken.validUntil).toISOString(),
    },
  };
}

export function validateUploadedAttachmentRef(value: unknown, now = Date.now()): UploadedAttachmentRef | null {
  const descriptor = validateAttachmentDescriptor(value);
  if (!descriptor || !value || typeof value !== "object") return null;
  const input = value as Partial<UploadedAttachmentRef>;
  const pathname = typeof input.pathname === "string" ? input.pathname.trim() : "";
  const readUrl = typeof input.readUrl === "string" ? input.readUrl.trim() : "";
  const expiresAt = typeof input.expiresAt === "string" ? input.expiresAt.trim() : "";
  const expiry = Date.parse(expiresAt);
  if (!pathname.startsWith("ai-chat/") || pathname.length > 300 || !Number.isFinite(expiry) || expiry <= now || expiry > now + ATTACHMENT_READ_TTL_MS + 60_000) return null;
  let url: URL;
  let decodedPathname: string;
  try {
    url = new URL(readUrl);
    decodedPathname = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".private.blob.vercel-storage.com")) return null;
  if (decodedPathname !== pathname) return null;
  if (!url.searchParams.has("vercel-blob-delegation") || !url.searchParams.has("vercel-blob-signature")) return null;
  return { ...descriptor, pathname, readUrl, expiresAt };
}
