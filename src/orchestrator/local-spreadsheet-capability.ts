import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import { LocalFileCapability } from "./local-file-capability.ts";
import type { SpreadsheetCell, SpreadsheetWorkbook } from "./spreadsheet-sandbox-capability.ts";
import type { WorkAction, WorkCapability, WorkResult } from "./work-capability.ts";

const MAX_XLSX_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

interface ZipEntry { name: string; bytes: Buffer }
interface CentralEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}
interface SheetDescriptor { name: string; target: string }

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
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("invalid xlsx zip: end of central directory not found");
}

function safeZipName(name: string): void {
  if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => part === "..")) {
    throw new Error("unsafe xlsx zip entry path");
  }
}

function parseZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > MAX_XLSX_BYTES) throw new Error("xlsx exceeds size limit");
  if (bytes.length < 22) throw new Error("invalid xlsx zip");
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error("multi-disk xlsx zip is not supported");
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error("xlsx has too many zip entries");
  if (centralOffset + centralSize > eocd) throw new Error("invalid xlsx central directory");

  const entries: CentralEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("invalid xlsx central directory entry");
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
    if (end > bytes.length) throw new Error("truncated xlsx central directory");
    if ((flags & 0x1) !== 0) throw new Error("encrypted xlsx entries are not supported");
    if (method !== 0 && method !== 8) throw new Error(`unsupported xlsx zip compression method: ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error("zip64 xlsx is not supported");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("xlsx entry exceeds size limit");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("xlsx expanded size exceeds limit");
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    safeZipName(name);
    entries.push({ name, method, crc32: checksum, compressedSize, uncompressedSize, localHeaderOffset });
    cursor = end;
  }

  const result = new Map<string, Buffer>();
  for (const entry of entries) {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error("invalid xlsx local file header");
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) throw new Error("truncated xlsx zip entry");
    const compressed = bytes.subarray(dataStart, dataEnd);
    const expanded = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    if (expanded.length !== entry.uncompressedSize) throw new Error("xlsx zip entry size mismatch");
    if (crc32(expanded) !== entry.crc32) throw new Error("xlsx zip entry checksum mismatch");
    if (result.has(entry.name)) throw new Error("duplicate xlsx zip entry");
    result.set(entry.name, expanded);
  }
  return result;
}

function attribute(xml: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? xmlUnescape(match[1]) : undefined;
}

function validateSheetName(name: string): void {
  if (!name || name.length > 31 || /[\\/*?:[\]]/.test(name)) throw new Error(`invalid spreadsheet sheet name: ${name || "<empty>"}`);
}

function validateCellRef(cell: string): string {
  const normalized = cell.toUpperCase();
  if (!/^[A-Z]{1,3}[1-9][0-9]*$/.test(normalized)) throw new Error(`invalid spreadsheet cell reference: ${cell}`);
  return normalized;
}

function normalizeWorkbook(raw: unknown): SpreadsheetWorkbook {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SpreadsheetWorkbook).cells)) throw new Error("workbook.cells must be an array");
  const cells: SpreadsheetCell[] = [];
  const seen = new Set<string>();
  for (const rawCell of (raw as SpreadsheetWorkbook).cells) {
    if (!rawCell || typeof rawCell !== "object") throw new Error("spreadsheet cell must be an object");
    const sheet = String(rawCell.sheet ?? "");
    validateSheetName(sheet);
    const cell = validateCellRef(String(rawCell.cell ?? ""));
    const key = `${sheet}!${cell}`;
    if (seen.has(key)) throw new Error(`duplicate spreadsheet cell: ${key}`);
    seen.add(key);
    const formula = rawCell.formula;
    if (formula !== undefined && typeof formula !== "string") throw new Error(`invalid formula at ${key}`);
    const value = rawCell.value;
    if (value !== undefined && value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`unsupported spreadsheet value at ${key}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`non-finite spreadsheet value at ${key}`);
    cells.push({ sheet, cell, ...(value !== undefined ? { value } : {}), ...(formula !== undefined ? { formula } : {}) });
  }
  return { cells };
}

function sheetXml(cells: SpreadsheetCell[]): string {
  const sorted = [...cells].sort((a, b) => a.cell.localeCompare(b.cell, "en", { numeric: true }));
  const rendered = sorted.map((item) => {
    const ref = validateCellRef(item.cell);
    const formula = item.formula === undefined ? "" : `<f>${xmlEscape(item.formula.replace(/^=/, ""))}</f>`;
    if (typeof item.value === "string") {
      if (item.formula !== undefined) return `<c r="${ref}" t="str">${formula}<v>${xmlEscape(item.value)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(item.value)}</t></is></c>`;
    }
    if (typeof item.value === "boolean") return `<c r="${ref}" t="b">${formula}<v>${item.value ? "1" : "0"}</v></c>`;
    if (typeof item.value === "number") return `<c r="${ref}">${formula}<v>${item.value}</v></c>`;
    return `<c r="${ref}">${formula}</c>`;
  });
  const byRow = new Map<number, string[]>();
  for (const cell of rendered) {
    const match = /\br="(?:[A-Z]+)([0-9]+)"/.exec(cell);
    const row = Number(match?.[1] ?? 1);
    const group = byRow.get(row) ?? [];
    group.push(cell);
    byRow.set(row, group);
  }
  const rows = [...byRow.entries()].sort(([a], [b]) => a - b)
    .map(([row, values]) => `<row r="${row}">${values.join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function encodeXlsx(workbookInput: SpreadsheetWorkbook): Buffer {
  const workbook = normalizeWorkbook(workbookInput);
  const sheetNames = [...new Set(workbook.cells.map((cell) => cell.sheet))];
  if (sheetNames.length === 0) sheetNames.push("Sheet1");
  if (sheetNames.length > 32) throw new Error("too many spreadsheet sheets");
  const workbookSheets = sheetNames.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`) },
    { name: "_rels/.rels", bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`) },
  ];
  sheetNames.forEach((name, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, bytes: Buffer.from(sheetXml(workbook.cells.filter((cell) => cell.sheet === name))) }));
  return makeZip(entries);
}

function parseRelationships(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    if (attribute(tag, "TargetMode")?.toLowerCase() === "external") throw new Error("external xlsx relationships are not supported");
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target) result.set(id, target);
  }
  return result;
}

function sharedStrings(entries: Map<string, Buffer>): string[] {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [];
  const xml = bytes.toString("utf8");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlUnescape(text[1])).join(""));
}

function sheetDescriptors(entries: Map<string, Buffer>): SheetDescriptor[] {
  const workbookBytes = entries.get("xl/workbook.xml");
  const relBytes = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relBytes) throw new Error("xlsx is missing workbook metadata");
  const rels = parseRelationships(relBytes.toString("utf8"));
  const descriptors: SheetDescriptor[] = [];
  for (const match of workbookBytes.toString("utf8").matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = match[0];
    const name = attribute(tag, "name");
    const relation = attribute(tag, "r:id");
    if (!name || !relation) throw new Error("xlsx sheet metadata is incomplete");
    validateSheetName(name);
    const target = rels.get(relation);
    if (!target) throw new Error(`xlsx sheet relationship missing: ${relation}`);
    const normalized = posix.normalize(posix.join("xl", target));
    if (!normalized.startsWith("xl/") || normalized.includes("../")) throw new Error("xlsx sheet relationship escapes workbook");
    descriptors.push({ name, target: normalized });
  }
  if (descriptors.length === 0) throw new Error("xlsx contains no sheets");
  return descriptors;
}

function parseSheet(sheet: SheetDescriptor, xml: string, strings: string[]): SpreadsheetCell[] {
  const cells: SpreadsheetCell[] = [];
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1];
    const body = match[2] ?? "";
    const ref = attribute(attrs, "r");
    if (!ref) continue;
    const cell = validateCellRef(ref);
    const type = attribute(attrs, "t");
    const formulaMatch = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body);
    const formula = formulaMatch ? xmlUnescape(formulaMatch[1]) : undefined;
    const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
    const inlineMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
    let value: SpreadsheetCell["value"];
    if (type === "inlineStr") {
      const pieces = [...(inlineMatch?.[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
      value = pieces.map((piece) => xmlUnescape(piece[1])).join("");
    } else if (type === "s") {
      if (!valueMatch) throw new Error(`shared-string xlsx cell is missing value: ${sheet.name}!${cell}`);
      const index = Number(valueMatch[1]);
      if (!Number.isInteger(index) || index < 0 || index >= strings.length) throw new Error(`invalid shared-string index at ${sheet.name}!${cell}`);
      value = strings[index];
    } else if (type === "b") value = valueMatch?.[1] === "1";
    else if (type === "str") value = valueMatch ? xmlUnescape(valueMatch[1]) : "";
    else if (valueMatch) {
      const number = Number(valueMatch[1]);
      if (!Number.isFinite(number)) throw new Error(`invalid numeric value at ${sheet.name}!${cell}`);
      value = number;
    } else value = null;
    cells.push({ sheet: sheet.name, cell, ...(value !== undefined ? { value } : {}), ...(formula !== undefined ? { formula } : {}) });
  }
  return cells;
}

export function decodeXlsx(bytes: Buffer): SpreadsheetWorkbook {
  const entries = parseZip(bytes);
  if (!entries.has("[Content_Types].xml") || !entries.has("_rels/.rels")) throw new Error("not a valid xlsx OOXML package");
  if (entries.has("xl/vbaProject.bin") || [...entries.keys()].some((name) => name.startsWith("xl/externalLinks/"))) throw new Error("macro or external-link xlsx content is not supported");
  const strings = sharedStrings(entries);
  const cells: SpreadsheetCell[] = [];
  for (const sheet of sheetDescriptors(entries)) {
    const content = entries.get(sheet.target);
    if (!content) throw new Error(`xlsx worksheet is missing: ${sheet.target}`);
    cells.push(...parseSheet(sheet, content.toString("utf8"), strings));
  }
  return normalizeWorkbook({ cells });
}

function ensureXlsxPath(path: unknown): string {
  if (typeof path !== "string" || !path.toLowerCase().endsWith(".xlsx")) throw new Error("spreadsheet.local only supports .xlsx paths");
  return path;
}

export class LocalSpreadsheetCapability implements WorkCapability {
  readonly name = "spreadsheet.local";
  readonly domain = "spreadsheet" as const;
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
      const path = ensureXlsxPath(action.input.path);
      if (action.operation === "read") {
        const artifact = await this.files.readBytes(path);
        const workbook = decodeXlsx(artifact.bytes);
        return this.ok(action, { path: artifact.target, sha256: artifact.sha256, workbook }, [], artifact.target, artifact.sha256, workbook);
      }
      if (action.operation === "write") {
        const workbook = normalizeWorkbook(action.input.workbook ?? { cells: action.input.cells });
        const artifact = await this.files.createBytes(path, encodeXlsx(workbook));
        if (artifact.status === "blocked") {
          return {
            ok: false,
            status: "blocked",
            outputs: { path: artifact.target, currentSha256: artifact.currentSha256, requestedSha256: artifact.sha256 },
            changes: [],
            evidence: [{ kind: "spreadsheet.overwrite_blocked", ref: `file:${artifact.target}`, data: { path: artifact.target, currentSha256: artifact.currentSha256, requestedSha256: artifact.sha256 } }],
            failureClass: "policy",
            error: "overwrite requires an approved replacement path",
            provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
          };
        }
        const persisted = await this.files.readBytes(path);
        const decoded = decodeXlsx(persisted.bytes);
        return this.ok(
          action,
          { path: persisted.target, sha256: persisted.sha256, workbook: decoded, ...(artifact.status === "idempotent" ? { idempotent: true } : {}) },
          artifact.status === "created" ? [{ resource: persisted.target, operation: "create", reversible: true }] : [],
          persisted.target,
          persisted.sha256,
          decoded,
        );
      }
      throw new Error("unsupported spreadsheet operation");
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        outputs: {},
        changes: [],
        evidence: [],
        failureClass: "implementation",
        error: error instanceof Error ? error.message : "spreadsheet operation failed",
        provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
      };
    }
  }

  private ok(action: WorkAction, outputs: Record<string, unknown>, changes: WorkResult["changes"], path: string, sha256: string, workbook: SpreadsheetWorkbook): WorkResult {
    return {
      ok: true,
      status: "completed",
      outputs,
      changes,
      evidence: [{ kind: "spreadsheet.artifact", ref: `file:${path}`, data: { path, sha256, sheets: [...new Set(workbook.cells.map((cell) => cell.sheet))], cellCount: workbook.cells.length } }],
      provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
    };
  }
}
