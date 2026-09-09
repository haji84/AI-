import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommandEnvelope } from "../src/orchestrator/command-ingress.ts";

const attachment = {
  name: "photo.jpg",
  contentType: "image/jpeg",
  size: 12345,
  pathname: "ai-chat/123-photo.jpg",
  readUrl: "https://store.private.blob.vercel-storage.com/ai-chat/123-photo.jpg?vercel-blob-delegation=x&vercel-blob-signature=y",
  expiresAt: "2026-09-10T12:00:00.000Z",
};

test("command envelopeはprivate Blob添付参照を保持する", () => {
  const command = normalizeCommandEnvelope({ source: "chat", command: "この画像を確認して", attachments: [attachment] });
  assert.deepEqual(command.attachments, [attachment]);
});

test("public URLを添付参照として受け付けない", () => {
  assert.throws(
    () => normalizeCommandEnvelope({ source: "chat", command: "確認", attachments: [{ ...attachment, readUrl: "https://example.com/photo.jpg" }] }),
    /private Vercel Blob/,
  );
});

test("添付は6件までに制限する", () => {
  assert.throws(
    () => normalizeCommandEnvelope({ source: "chat", command: "確認", attachments: Array.from({ length: 7 }, (_, index) => ({ ...attachment, name: `${index}.jpg` })) }),
    /at most 6/,
  );
});
