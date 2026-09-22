import { inflateRawSync } from "node:zlib";
import { LocalFileCapability } from "./local-file-capability.ts";
import type { SandboxDocument } from "./document-sandbox-capability.ts";
import type { WorkAction, WorkCapability, WorkResult } from "./work-capability.ts";

const MAX_DOCX_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_SECTIONS = 128;

interface ZipEntry { name: string; bytes: Buffer }
interface CentralEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function xmlUnescape(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error("invalid docx zip: end of central directory not found");
}

function safeZipName(name: string): void {
  if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => part === "..")) {
    throw new Error("unsafe docx zip entry path");
  }
}

function parseZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("docx exceeds size limit");
  if (bytes.length < 22) throw new Error("invalid docx zip");
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error("multi-disk docx zip is not supported");
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("docx has too many zip entries");
  if (centralOffset + centralSize !== eocd) throw new Error("invalid docx central directory");

  const entries: CentralEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("invalid docx central directory entry");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw new Error("truncated docx central directory");
    if ((flags & 0x1) !== 0) throw new Error("encrypted docx entries are not supported");
    if (method !== 0 && method !== 8) throw new Error(`unsupported docx zip compression method: ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error("zip64 docx is not supported");
    if (localHeaderOffset >= centralOffset) throw new Error("invalid docx local header offset");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("docx entry exceeds size limit");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("docx expanded size exceeds limit");
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    safeZipName(name);
    entries.push({ name, method, crc32: checksum, compressedSize, uncompressedSize, localHeaderOffset });
    cursor = end;
  }
  if (cursor !== eocd) throw new Error("invalid docx central directory length");

  const result = new Map<string, Buffer>();
  for (const entry of entries) {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > centralOffset || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error("invalid docx local file header");
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > centralOffset) throw new Error("truncated docx zip entry");
    const localName = bytes.toString("utf8", nameStart, nameEnd);
    if (localName !== entry.name) throw new Error("docx zip entry name mismatch");
    const compressed = bytes.subarray(dataStart, dataEnd);
    const expanded = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_ENTRY_BYTES + 1, entry.uncompressedSize + 1) });
    if (expanded.length !== entry.uncompressedSize) throw new Error("docx zip entry size mismatch");
    if (crc32(expanded) !== entry.crc32) throw new Error("docx zip entry checksum mismatch");
    if (result.has(entry.name)) throw new Error("duplicate docx zip entry");
    result.set(entry.name, expanded);
  }
  return result;
}

function normalizeDocument(raw: unknown): SandboxDocument {
  if (!raw || typeof raw !== "object") throw new Error("document must be an object");
  const candidate = raw as Partial<SandboxDocument>;
  if (typeof candidate.title !== "string") throw new Error("document title must be a string");
  if (!candidate.sections || typeof candidate.sections !== "object" || Array.isArray(candidate.sections)) {
    throw new Error("document sections must be an object");
  }
  const entries = Object.entries(candidate.sections);
  if (entries.length > MAX_SECTIONS) throw new Error("document has too many sections");
  const sections: Record<string, string> = {};
  let bytes = Buffer.byteLength(candidate.title, "utf8");
  for (const [name, value] of entries) {
    if (!name.trim() || name.length > 200) throw new Error("document section name is invalid");
    if (typeof value !== "string") throw new Error(`document section must be a string: ${name}`);
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > MAX_DOCUMENT_TEXT_BYTES) throw new Error("document text exceeds size limit");
    sections[name] = value;
  }
  return { title: candidate.title, sections };
}

function paragraph(text: string, style?: string): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${xmlEscape(style)}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function documentXml(document: SandboxDocument): string {
  const body: string[] = [paragraph(document.title, "Title")];
  for (const [name, value] of Object.entries(document.sections)) {
    body.push(paragraph(name, "Heading1"));
    const lines = value.split("\n");
    for (const line of lines.length ? lines : [""]) body.push(paragraph(line));
  }
  body.push(`<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`;
}

export function encodeDocx(documentInput: SandboxDocument): Buffer {
  const document = normalizeDocument(documentInput);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style>` +
    `</w:styles>`;
  return makeZip([
    { name: "[Content_Types].xml", bytes: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", bytes: Buffer.from(rootRelationships, "utf8") },
    { name: "word/document.xml", bytes: Buffer.from(documentXml(document), "utf8") },
    { name: "word/_rels/document.xml.rels", bytes: Buffer.from(documentRelationships, "utf8") },
    { name: "word/styles.xml", bytes: Buffer.from(styles, "utf8") },
  ]);
}

function rejectUnsafePackage(entries: Map<string, Buffer>): void {
  if (!entries.has("[Content_Types].xml") || !entries.has("_rels/.rels") || !entries.has("word/document.xml")) {
    throw new Error("not a valid docx OOXML package");
  }
  for (const name of entries.keys()) {
    const lower = name.toLowerCase();
    if (lower.endsWith("vbaproject.bin") || lower.startsWith("word/embeddings/") || lower.startsWith("word/activex/") || lower.startsWith("word/afchunk/")) {
      throw new Error("active or embedded docx content is not supported");
    }
  }
  for (const [name, bytes] of entries) {
    if (!name.endsWith(".rels")) continue;
    const xml = bytes.toString("utf8");
    if (/<Relationship\b[^>]*\bTargetMode="External"/i.test(xml)) throw new Error("external docx relationships are not supported");
  }
}

function paragraphText(xml: string): string {
  let result = "";
  const token = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  for (const match of xml.matchAll(token)) {
    if (match[1] !== undefined) result += xmlUnescape(match[1]);
    else if (match[0].startsWith("<w:tab")) result += "\t";
    else result += "\n";
  }
  return result;
}

function paragraphStyle(xml: string): string | undefined {
  const match = /<w:pStyle\b[^>]*\bw:val="([^"]+)"[^>]*\/>/i.exec(xml);
  return match ? xmlUnescape(match[1]) : undefined;
}

export function decodeDocx(bytes: Buffer): SandboxDocument {
  const entries = parseZip(bytes);
  rejectUnsafePackage(entries);
  const documentBytes = entries.get("word/document.xml");
  if (!documentBytes) throw new Error("docx document part is missing");
  const xml = documentBytes.toString("utf8");
  const sections: Record<string, string[]> = {};
  let title = "";
  let currentSection: string | undefined;

  for (const match of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const body = match[1];
    const style = paragraphStyle(body);
    const text = paragraphText(body);
    if (style?.toLowerCase() === "title") {
      if (title && text !== title) throw new Error("docx contains multiple title paragraphs");
      title = text;
      currentSection = undefined;
      continue;
    }
    if (/^heading[1-6]$/i.test(style ?? "")) {
      if (!text.trim()) throw new Error("docx contains an empty section heading");
      if (Object.hasOwn(sections, text)) throw new Error(`docx contains duplicate section heading: ${text}`);
      sections[text] = [];
      currentSection = text;
      continue;
    }
    if (currentSection) {
      sections[currentSection].push(text);
      continue;
    }
    if (!title && text) title = text;
  }

  const normalized = normalizeDocument({
    title,
    sections: Object.fromEntries(Object.entries(sections).map(([name, lines]) => [name, lines.join("\n")])),
  });
  return normalized;
}

function ensureDocxPath(path: unknown): string {
  if (typeof path !== "string" || !path.toLowerCase().endsWith(".docx")) throw new Error("document.local only supports .docx paths");
  return path;
}

export class LocalDocumentCapability implements WorkCapability {
  readonly name = "document.local";
  readonly domain = "document" as const;
  readonly operations = ["read", "write"];
  readonly access = "write" as const;
  readonly externalSideEffect = false;
  readonly maxRisk = "low" as const;
  readonly requiresHumanApproval = false;
  private readonly files: LocalFileCapability;

  constructor(root: string) { this.files = new LocalFileCapability(root); }
  async available() { return this.files.available(); }

  async execute(action: WorkAction): Promise<WorkResult> {
    try {
      const path = ensureDocxPath(action.input.path);
      if (action.operation === "read") {
        const artifact = await this.files.readBytes(path);
        const document = decodeDocx(artifact.bytes);
        return this.ok(action, { path: artifact.target, sha256: artifact.sha256, document }, [], artifact.target, artifact.sha256, document);
      }
      if (action.operation === "write") {
        const document = normalizeDocument(action.input.document ?? { title: action.input.title, sections: action.input.sections });
        const artifact = await this.files.createBytes(path, encodeDocx(document));
        if (artifact.status === "blocked") {
          return {
            ok: false,
            status: "blocked",
            outputs: { path: artifact.target, currentSha256: artifact.currentSha256, requestedSha256: artifact.sha256 },
            changes: [],
            evidence: [{ kind: "document.overwrite_blocked", ref: `file:${artifact.target}`, data: { path: artifact.target, currentSha256: artifact.currentSha256, requestedSha256: artifact.sha256 } }],
            failureClass: "policy",
            error: "overwrite requires an approved replacement path",
            provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
          };
        }
        const persisted = await this.files.readBytes(path);
        const decoded = decodeDocx(persisted.bytes);
        return this.ok(
          action,
          { path: persisted.target, sha256: persisted.sha256, document: decoded, ...(artifact.status === "idempotent" ? { idempotent: true } : {}) },
          artifact.status === "created" ? [{ resource: persisted.target, operation: "create", reversible: true }] : [],
          persisted.target,
          persisted.sha256,
          decoded,
        );
      }
      throw new Error("unsupported document operation");
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        outputs: {},
        changes: [],
        evidence: [],
        failureClass: "implementation",
        error: error instanceof Error ? error.message : "document operation failed",
        provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
      };
    }
  }

  private ok(action: WorkAction, outputs: Record<string, unknown>, changes: WorkResult["changes"], path: string, sha256: string, document: SandboxDocument): WorkResult {
    return {
      ok: true,
      status: "completed",
      outputs,
      changes,
      evidence: [{ kind: "document.artifact", ref: `file:${path}`, data: { path, sha256, sectionCount: Object.keys(document.sections).length } }],
      provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
    };
  }
}
