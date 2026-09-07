import assert from "node:assert/strict";
import test from "node:test";
import { findZipEntry } from "../src/app/github-artifact-state.ts";

function storedZipEntry(name: string, content: string): Buffer {
  const nameBytes = Buffer.from(name, "utf-8");
  const data = Buffer.from(content, "utf-8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, data]);
}

test("findZipEntry reads a stored reasoning-feedback artifact entry", () => {
  const payload = JSON.stringify({ status: "approval_required", approvalKey: "abc" });
  const zip = storedZipEntry("reasoning-feedback.json", payload);
  assert.equal(findZipEntry(zip, "reasoning-feedback.json")?.toString("utf-8"), payload);
});

test("findZipEntry returns null for a missing entry", () => {
  const zip = storedZipEntry("run-summary.json", "{}");
  assert.equal(findZipEntry(zip, "reasoning-feedback.json"), null);
});
