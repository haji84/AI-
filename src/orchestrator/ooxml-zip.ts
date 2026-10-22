import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ENTRIES = 128;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function createOoxmlZip(entries: ZipEntry[]): Buffer {
  if (!entries.length || entries.length > MAX_ENTRIES) throw new Error("invalid OOXML ZIP entry count");
  const seen = new Set<string>();
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;
  let totalUncompressed = 0;

  for (const entry of entries) {
    assertSafeZipName(entry.name);
    if (seen.has(entry.name)) throw new Error(`duplicate OOXML ZIP entry: ${entry.name}`);
    seen.add(entry.name);
    if (entry.data.length > MAX_ENTRY_BYTES) throw new Error(`OOXML ZIP entry too large: ${entry.name}`);
    totalUncompressed += entry.data.length;
    if (totalUncompressed > MAX_TOTAL_BYTES) throw new Error("OOXML ZIP exceeds uncompressed size limit");

    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralChunks.push(central, name);

    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, end]);
}

export function readOoxmlZip(bytes: Uint8Array): Map<string, Buffer> {
  const archive = Buffer.from(bytes);
  const eocdOffset = findEocd(archive);
  const disk = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntries = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);

  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error("multi-disk OOXML ZIP is not supported");
  if (!entryCount || entryCount > MAX_ENTRIES) throw new Error("invalid OOXML ZIP entry count");
  if (eocdOffset + 22 + commentLength !== archive.length) throw new Error("invalid OOXML ZIP trailer");
  if (centralOffset + centralSize > eocdOffset) throw new Error("invalid OOXML ZIP central directory");

  const result = new Map<string, Buffer>();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(archive, cursor, 46);
    if (archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) throw new Error("invalid OOXML ZIP central header");

    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);

    if (flags & 0x0001) throw new Error("encrypted OOXML ZIP entries are not supported");
    if (flags & ~(0x0008 | 0x0800)) throw new Error("unsupported OOXML ZIP flags");
    if (method !== 0 && method !== 8) throw new Error("unsupported OOXML ZIP compression method");
    if (compressedSize > MAX_ENTRY_BYTES || uncompressedSize > MAX_ENTRY_BYTES) throw new Error("OOXML ZIP entry exceeds size limit");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_BYTES) throw new Error("OOXML ZIP exceeds uncompressed size limit");

    ensureRange(archive, cursor + 46, nameLength + extraLength + entryCommentLength);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assertSafeZipName(name);
    if (result.has(name)) throw new Error(`duplicate OOXML ZIP entry: ${name}`);

    ensureRange(archive, localOffset, 30);
    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error("invalid OOXML ZIP local header");
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== method) throw new Error("OOXML ZIP header mismatch");

    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    ensureRange(archive, dataOffset, compressedSize);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES }) : Buffer.from(compressed);
    if (data.length !== uncompressedSize) throw new Error(`OOXML ZIP size mismatch: ${name}`);
    if (crc32(data) !== expectedCrc) throw new Error(`OOXML ZIP CRC mismatch: ${name}`);
    result.set(name, data);

    cursor += 46 + nameLength + extraLength + entryCommentLength;
  }

  if (cursor !== centralOffset + centralSize) throw new Error("OOXML ZIP central directory size mismatch");
  return result;
}

function findEocd(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("OOXML ZIP end record not found");
}

function ensureRange(buffer: Buffer, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error("invalid OOXML ZIP range");
  }
}

function assertSafeZipName(name: string): void {
  if (!name || name.length > 512 || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error("unsafe OOXML ZIP entry name");
  }
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === "")) throw new Error("unsafe OOXML ZIP entry name");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
