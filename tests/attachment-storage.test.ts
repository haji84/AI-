import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACHMENT_READ_TTL_MS,
  MAX_ATTACHMENT_SIZE_BYTES,
  createAttachmentUploadGrant,
  inferAttachmentType,
  validateAttachmentDescriptor,
  validateUploadedAttachmentRef,
} from "../src/app/attachment-storage.ts";

test("attachment descriptors accept intended media/document types and infer Office MIME", () => {
  assert.deepEqual(validateAttachmentDescriptor({ name: "photo.jpg", type: "image/jpeg", size: 123 }), { name: "photo.jpg", type: "image/jpeg", size: 123 });
  assert.deepEqual(validateAttachmentDescriptor({ name: "movie.mp4", type: "video/mp4", size: 456 }), { name: "movie.mp4", type: "video/mp4", size: 456 });
  assert.equal(inferAttachmentType("report.docx", "application/octet-stream"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(inferAttachmentType("memo.txt", ""), "text/plain");
  assert.equal(validateAttachmentDescriptor({ name: "app.exe", type: "application/octet-stream", size: 100 }), null);
  assert.equal(validateAttachmentDescriptor({ name: "bad\nname.pdf", type: "application/pdf", size: 100 }), null);
  assert.equal(validateAttachmentDescriptor({ name: "huge.pdf", type: "application/pdf", size: MAX_ATTACHMENT_SIZE_BYTES + 1 }), null);
});

test("upload grant is scoped to one private pathname and never exposes the signing secret", async () => {
  const now = Date.now();
  const delegationPayload = {
    storeId: "teststore",
    ownerId: "owner",
    pathname: "placeholder",
    operations: ["put", "get"],
    validUntil: now + ATTACHMENT_READ_TTL_MS,
    iat: now,
    maximumSizeInBytes: 321,
    allowedContentTypes: ["application/pdf"],
  };
  let requestBody: Record<string, unknown> | undefined;
  const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    delegationPayload.pathname = String(requestBody.pathname);
    return new Response(JSON.stringify({
      delegationToken: `${Buffer.from(JSON.stringify(delegationPayload)).toString("base64url")}.delegation-signature`,
      clientSigningToken: "server-only-signing-key",
      validUntil: delegationPayload.validUntil,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const grant = await createAttachmentUploadGrant(
    { name: "report.pdf", type: "application/pdf", size: 321 },
    "vercel_blob_rw_teststore_secret-value",
    fakeFetch as typeof fetch,
  );

  assert.equal(requestBody?.maximumSizeInBytes, 321);
  assert.deepEqual(requestBody?.allowedContentTypes, ["application/pdf"]);
  assert.deepEqual(requestBody?.operations, ["put", "get"]);
  assert.match(grant.attachment.pathname, /^ai-chat\/\d{4}-\d{2}\/[0-9a-f-]+-report\.pdf$/);

  const upload = new URL(grant.uploadUrl);
  assert.equal(upload.hostname, "vercel.com");
  assert.equal(upload.searchParams.get("pathname"), grant.attachment.pathname);
  assert.equal(upload.searchParams.get("vercel-blob-maximum-size-in-bytes"), "321");
  assert.equal(upload.searchParams.get("vercel-blob-allowed-content-types"), "application/pdf");
  assert.equal(upload.searchParams.get("vercel-blob-allow-overwrite"), "false");
  assert.equal(upload.searchParams.get("vercel-blob-add-random-suffix"), "false");

  const read = new URL(grant.attachment.readUrl);
  assert.equal(read.hostname, "teststore.private.blob.vercel-storage.com");
  assert.ok(read.searchParams.has("vercel-blob-delegation"));
  assert.ok(read.searchParams.has("vercel-blob-signature"));
  assert.equal(grant.uploadUrl.includes("server-only-signing-key"), false);
  assert.equal(grant.attachment.readUrl.includes("server-only-signing-key"), false);
});

test("uploaded attachment refs reject public hosts and expired grants", () => {
  const now = Date.now();
  const base = {
    name: "memo.txt",
    type: "text/plain",
    size: 10,
    pathname: "ai-chat/2026-09/id-memo.txt",
    expiresAt: new Date(now + 30_000).toISOString(),
  };
  const signedQuery = "?vercel-blob-delegation=token&vercel-blob-signature=sig";
  assert.ok(validateUploadedAttachmentRef({ ...base, readUrl: `https://abc.private.blob.vercel-storage.com/${base.pathname}${signedQuery}` }, now));
  assert.equal(validateUploadedAttachmentRef({ ...base, readUrl: `https://abc.public.blob.vercel-storage.com/${base.pathname}${signedQuery}` }, now), null);
  assert.equal(validateUploadedAttachmentRef({ ...base, expiresAt: new Date(now - 1).toISOString(), readUrl: `https://abc.private.blob.vercel-storage.com/${base.pathname}${signedQuery}` }, now), null);
});
