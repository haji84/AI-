import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { findZipEntry } from "./github-artifact-state.ts";

function makeZipWithDataDescriptor(filename: string, content: Buffer): Buffer {
  const name = Buffer.from(filename, "utf-8");
  const compressed = deflateRawSync(content);

  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x08, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(0, 4);
  descriptor.writeUInt32LE(compressed.length, 8);
  descriptor.writeUInt32LE(content.length, 12);

  const centralOffset = local.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x08, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, compressed, descriptor, central, eocd]);
}

test("findZipEntry reads deflated entries that use a data descriptor", () => {
  const expected = Buffer.from('{"status":"approval_required"}\n');
  const zip = makeZipWithDataDescriptor("reasoning-feedback.json", expected);
  const actual = findZipEntry(zip, "reasoning-feedback.json");
  assert.deepEqual(actual, expected);
});

test("findZipEntry returns null for a missing entry", () => {
  const zip = makeZipWithDataDescriptor("reasoning-feedback.json", Buffer.from("{}"));
  assert.equal(findZipEntry(zip, "run-summary.json"), null);
});
