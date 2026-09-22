import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeDocx, LocalDocumentCapability } from "../src/orchestrator/local-document-capability.ts";
import type { WorkAction } from "../src/orchestrator/work-capability.ts";

function action(operation: string, path: string, input: Record<string, unknown> = {}): WorkAction {
  return {
    goalId: "g",
    jobId: "j",
    attemptId: "a",
    strategyId: "s",
    capability: "document.local",
    domain: "document",
    operation,
    input: { path, ...input },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: "document.required_sections", required: true, spec: {} },
  };
}

test("local document adapter writes a real OOXML docx and round-trips title/sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-docx-"));
  try {
    const capability = new LocalDocumentCapability(root);
    assert.equal(await capability.available(), true);
    const document = {
      title: "Runbook & <Ops>",
      sections: {
        Intro: "hello\nsecond line",
        Details: "value > zero & stable",
        Empty: "",
      },
    };

    const written = await capability.execute(action("write", "artifacts/runbook.docx", { document }));
    assert.equal(written.ok, true);
    assert.match(String(written.outputs.sha256), /^[a-f0-9]{64}$/);
    assert.equal(written.evidence[0]?.kind, "document.artifact");
    assert.deepEqual(written.evidence[0]?.data && (written.evidence[0].data as Record<string, unknown>).sectionCount, 3);

    const bytes = await readFile(join(root, "artifacts/runbook.docx"));
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    const packageText = bytes.toString("latin1");
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
    ]) {
      assert.equal(packageText.includes(part), true, `missing OOXML part ${part}`);
    }

    const read = await capability.execute(action("read", "artifacts/runbook.docx"));
    assert.equal(read.ok, true);
    assert.deepEqual(read.outputs.document, document);
    assert.equal(read.outputs.sha256, written.outputs.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local document adapter reads an independently deflated WordprocessingML fixture", () => {
  const fixture = Buffer.from("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", "base64");
  assert.deepEqual(decodeDocx(fixture), {
    title: "External Doc",
    sections: {
      Alpha: "one\ntwo",
      Beta: "three & four",
    },
  });
});

test("local document adapter rejects external relationships in OOXML", () => {
  const fixture = Buffer.from("UEsDBBQAAAAIAKETNl3mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACAChEzZdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgAoRM2XbDSx+uEAAAAswAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOwQ2DMAxFV0EZANMeekABVugKaUgBidiRnRa6feP00Mv7sp9sfTudcW/egWUjHMyl7cw02qOfyb9iwNwUjdIfg1lzTj2A+DVEJy2lgMU9iaPLZeQFDuI5MfkgsuESd7h23Q2i29DoywfNH82kYEUeTwsaSq6sUoLPd4a6+F3Bv9H4BVBLAwQUAAAACAChEzZd3Fmor6gAAAAbAQAAHAAAAHdvcmQvX3JlbHMvZG9jdW1lbnQueG1sLnJlbHONz00KwjAQBeCrhBygU10ISls3uujCjXiBIZ02ofkjiVJv74AIFly4nHnD95jmuDgrHpSyCb6Vm6qWx665ksXCi6xNzIIvfG6lLiUeALLS5DBXIZLnZAzJYeExTRBRzTgRbOt6B+nbkGtT9EMrUz/spbg9I/1jh3E0ik5B3R358qMCNEvJGj8zimmi8mYzu7Sgi5YqFRx80ksYuPi8FEoerYSugdXb3QtQSwECFAMUAAAACAChEzZd5nXEftIAAACLAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAKETNl1fM5VSlQAAAAcBAAALAAAAAAAAAAAAAACAAQMBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAKETNl2w0sfrhAAAALMAAAARAAAAAAAAAAAAAACAAcEBAAB3b3JkL2RvY3VtZW50LnhtbFBLAQIUAxQAAAAIAKETNl3cWaivqAAAABsBAAAcAAAAAAAAAAAAAACAAXQCAAB3b3JkL19yZWxzL2RvY3VtZW50LnhtbC5yZWxzUEsFBgAAAAAEAAQAAwEAAFYDAAAAAA==", "base64");
  assert.throws(() => decodeDocx(fixture), /external docx relationships are not supported/);
});

test("local document adapter is idempotent and blocks conflicting replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-docx-policy-"));
  try {
    const capability = new LocalDocumentCapability(root);
    const original = { title: "T", sections: { A: "one" } };
    const changed = { title: "T", sections: { A: "two" } };
    const first = await capability.execute(action("write", "result.docx", { document: original }));
    assert.equal(first.ok, true);
    assert.equal(first.changes[0]?.operation, "create");
    const repeated = await capability.execute(action("write", "result.docx", { document: original }));
    assert.equal(repeated.ok, true);
    assert.equal(repeated.outputs.idempotent, true);
    assert.deepEqual(repeated.changes, []);
    const replacement = await capability.execute(action("write", "result.docx", { document: changed }));
    assert.equal(replacement.ok, false);
    assert.equal(replacement.status, "blocked");
    assert.equal(replacement.failureClass, "policy");
    assert.equal(replacement.evidence[0]?.kind, "document.overwrite_blocked");
    const read = await capability.execute(action("read", "result.docx"));
    assert.deepEqual(read.outputs.document, original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local document adapter fails closed on path/symlink escape and malformed input", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-docx-root-"));
  const outside = await mkdtemp(join(tmpdir(), "jarvis-docx-outside-"));
  try {
    const capability = new LocalDocumentCapability(root);
    const document = { title: "safe", sections: { A: "body" } };
    const traversal = await capability.execute(action("write", "../escape.docx", { document }));
    assert.equal(traversal.ok, false);
    assert.match(traversal.error ?? "", /escapes allowed root/);

    await writeFile(join(outside, "outside.docx"), Buffer.from("not-a-docx"));
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const symlinkRead = await capability.execute(action("read", "escape/outside.docx"));
    assert.equal(symlinkRead.ok, false);
    assert.match(symlinkRead.error ?? "", /escapes allowed root/);

    await writeFile(join(root, "broken.docx"), Buffer.from("not-a-docx"));
    const malformed = await capability.execute(action("read", "broken.docx"));
    assert.equal(malformed.ok, false);
    assert.match(malformed.error ?? "", /invalid docx zip/);

    const wrongExtension = await capability.execute(action("write", "report.txt", { document }));
    assert.equal(wrongExtension.ok, false);
    assert.match(wrongExtension.error ?? "", /only supports \.docx/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
