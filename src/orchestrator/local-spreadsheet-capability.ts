import { posix as pathPosix } from "node:path";
import type { WorkAction, WorkCapability, WorkResult } from "./work-capability.ts";
import { createOoxmlZip, readOoxmlZip } from "./ooxml-zip.ts";
import { ArtifactConflictError, ScopedArtifactStore } from "./scoped-artifact-store.ts";

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 100_000;
const MAX_CELL_TEXT = 32_767;

type SpreadsheetCell = string | number | boolean | null;
type SpreadsheetRows = SpreadsheetCell[][];

export class LocalSpreadsheetCapability implements WorkCapability {
  readonly name = "spreadsheet.local";
  readonly domain = "spreadsheet" as const;
  readonly operations = ["read", "write"];
  readonly access = "write" as const;
  readonly externalSideEffect = false;
  readonly maxRisk = "low" as const;
  readonly requiresHumanApproval = false;

  private readonly store: ScopedArtifactStore;

  constructor(root: string) {
    this.store = new ScopedArtifactStore(root);
  }

  available(): Promise<boolean> {
    return this.store.available();
  }

  async execute(action: WorkAction): Promise<WorkResult> {
    try {
      const path = requireXlsxPath(action.input.path);
      if (action.operation === "read") {
        const artifact = await this.store.read(path);
        const rows = readWorkbook(artifact.bytes);
        return this.ok(action, rows, artifact.path, artifact.sha256, false, false);
      }

      if (action.operation === "write") {
        const rows = normalizeRows(action.input.rows);
        const workbook = writeWorkbook(rows);
        const artifact = await this.store.create(path, workbook);
        return this.ok(action, rows, artifact.path, artifact.sha256, artifact.created, artifact.idempotent);
      }

      throw new Error("unsupported spreadsheet operation");
    } catch (error) {
      if (error instanceof ArtifactConflictError) {
        return {
          ok: false,
          status: "blocked",
          outputs: {
            path: error.path,
            currentSha256: error.currentSha256,
            requestedSha256: error.requestedSha256,
          },
          changes: [],
          evidence: [
            {
              kind: "spreadsheet.overwrite_blocked",
              ref: `file:${error.path}`,
              data: {
                path: error.path,
                currentSha256: error.currentSha256,
                requestedSha256: error.requestedSha256,
              },
            },
          ],
          failureClass: "policy",
          error: error.message,
          provenance: {
            capability: this.name,
            attemptId: action.attemptId,
            strategyId: action.strategyId,
          },
        };
      }
      return {
        ok: false,
        status: "failed",
        outputs: {},
        changes: [],
        evidence: [],
        failureClass: "implementation",
        error: error instanceof Error ? error.message : "spreadsheet operation failed",
        provenance: {
          capability: this.name,
          attemptId: action.attemptId,
          strategyId: action.strategyId,
        },
      };
    }
  }

  private ok(
    action: WorkAction,
    rows: SpreadsheetRows,
    path: string,
    sha256: string,
    created: boolean,
    idempotent: boolean,
  ): WorkResult {
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      ok: true,
      status: "completed",
      outputs: {
        path,
        rows,
        rowCount: rows.length,
        columnCount,
        sha256,
        ...(idempotent ? { idempotent: true } : {}),
      },
      changes: created ? [{ resource: path, operation: "create", reversible: true }] : [],
      evidence: [
        {
          kind: "spreadsheet.artifact",
          ref: `file:${path}`,
          data: { path, sha256, rowCount: rows.length, columnCount },
        },
      ],
      provenance: {
        capability: this.name,
        attemptId: action.attemptId,
        strategyId: action.strategyId,
      },
    };
  }
}

function requireXlsxPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("path required");
  if (!value.toLowerCase().endsWith(".xlsx")) throw new Error("spreadsheet path must end in .xlsx");
  return value;
}

function normalizeRows(value: unknown): SpreadsheetRows {
  if (!Array.isArray(value)) throw new Error("spreadsheet rows must be an array");
  if (value.length > MAX_ROWS) throw new Error("spreadsheet row limit exceeded");
  let cellCount = 0;
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new Error(`spreadsheet row ${rowIndex + 1} must be an array`);
    if (row.length > MAX_COLUMNS) throw new Error("spreadsheet column limit exceeded");
    cellCount += row.length;
    if (cellCount > MAX_CELLS) throw new Error("spreadsheet cell limit exceeded");
    return row.map((cell, columnIndex) => normalizeCell(cell, rowIndex, columnIndex));
  });
}

function normalizeCell(value: unknown, rowIndex: number, columnIndex: number): SpreadsheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.length > MAX_CELL_TEXT) throw new Error(`spreadsheet cell ${cellRef(rowIndex, columnIndex)} exceeds text limit`);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`unsupported spreadsheet cell type at ${cellRef(rowIndex, columnIndex)}`);
}

function writeWorkbook(rows: SpreadsheetRows): Buffer {
  const worksheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => writeCell(cell, rowIndex, columnIndex))
        .filter(Boolean)
        .join("");
      return cells ? `<row r="${rowIndex + 1}">${cells}</row>` : `<row r="${rowIndex + 1}"/>`;
    })
    .join("");

  const entries = [
    xmlEntry(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    xmlEntry(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    xmlEntry(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    xmlEntry(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    xmlEntry(
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    ),
    xmlEntry(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheetRows}</sheetData></worksheet>`,
    ),
  ];
  return createOoxmlZip(entries);
}

function readWorkbook(bytes: Buffer): SpreadsheetRows {
  const entries = readOoxmlZip(bytes);
  const workbookXml = requiredXml(entries, "xl/workbook.xml");
  const relationshipsXml = requiredXml(entries, "xl/_rels/workbook.xml.rels");
  requiredXml(entries, "[Content_Types].xml");

  const sheetMatch = workbookXml.match(/<sheet\b([^>]*)\/?\s*>/i);
  if (!sheetMatch) throw new Error("spreadsheet has no worksheet");
  const relationshipId = attribute(sheetMatch[1], "r:id");
  if (!relationshipId) throw new Error("spreadsheet worksheet relationship missing");

  const relationships = [...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)];
  const relationship = relationships.find((match) => attribute(match[1], "Id") === relationshipId);
  const target = relationship ? attribute(relationship[1], "Target") : null;
  if (!target) throw new Error("spreadsheet worksheet target missing");
  const sheetPath = resolveWorkbookTarget(target);
  const worksheetXml = requiredXml(entries, sheetPath);

  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? readSharedStrings(requiredXml(entries, "xl/sharedStrings.xml"))
    : [];
  return readWorksheet(worksheetXml, sharedStrings);
}

function readWorksheet(xml: string, sharedStrings: string[]): SpreadsheetRows {
  const rows: SpreadsheetRows = [];
  let cells = 0;
  let sequentialRow = 1;

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/gi)) {
    const attrs = rowMatch[1] ?? rowMatch[3] ?? "";
    const body = rowMatch[2] ?? "";
    const explicitRow = parsePositiveInteger(attribute(attrs, "r"));
    const rowNumber = explicitRow ?? sequentialRow;
    if (rowNumber > MAX_ROWS) throw new Error("spreadsheet row limit exceeded");
    sequentialRow = rowNumber + 1;
    const row: SpreadsheetCell[] = rows[rowNumber - 1] ?? [];

    for (const cellMatch of body.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      cells += 1;
      if (cells > MAX_CELLS) throw new Error("spreadsheet cell limit exceeded");
      const cellAttrs = cellMatch[1];
      const cellBody = cellMatch[2];
      const reference = attribute(cellAttrs, "r");
      const columnIndex = reference ? columnIndexFromReference(reference) : row.length;
      if (columnIndex >= MAX_COLUMNS) throw new Error("spreadsheet column limit exceeded");
      row[columnIndex] = readCell(attribute(cellAttrs, "t"), cellBody, sharedStrings);
    }

    while (row.length && row[row.length - 1] === null) row.pop();
    rows[rowNumber - 1] = row;
  }

  while (rows.length && (!rows[rows.length - 1] || rows[rows.length - 1].length === 0)) rows.pop();
  return rows.map((row) => row ?? []);
}

function readCell(type: string | null, body: string, sharedStrings: string[]): SpreadsheetCell {
  if (type === "inlineStr") {
    const text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
    return text;
  }
  const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
  if (!valueMatch) return null;
  const raw = decodeXml(valueMatch[1]);
  if (type === "s") {
    const index = Number(raw);
    if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) throw new Error("invalid shared string index");
    return sharedStrings[index];
  }
  if (type === "b") return raw === "1";
  if (type === "str" || type === "e") return raw;
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error("invalid numeric spreadsheet value");
  return number;
}

function readSharedStrings(xml: string): string[] {
  const result: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => decodeXml(part[1])).join("");
    if (text.length > MAX_CELL_TEXT) throw new Error("shared string exceeds text limit");
    result.push(text);
    if (result.length > MAX_CELLS) throw new Error("shared string count exceeds limit");
  }
  return result;
}

function requiredXml(entries: Map<string, Buffer>, name: string): string {
  const value = entries.get(name);
  if (!value) throw new Error(`required OOXML part missing: ${name}`);
  const xml = value.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD/entity declarations are not allowed in OOXML");
  return xml;
}

function resolveWorkbookTarget(target: string): string {
  if (!target || target.includes("\\") || target.startsWith("/") || target.split("/").includes("..")) {
    throw new Error("unsafe spreadsheet relationship target");
  }
  const resolved = pathPosix.normalize(pathPosix.join("xl", target));
  if (!resolved.startsWith("xl/") || resolved.includes("../")) throw new Error("unsafe spreadsheet relationship target");
  return resolved;
}

function writeCell(value: SpreadsheetCell, rowIndex: number, columnIndex: number): string {
  if (value === null) return "";
  const reference = cellRef(rowIndex, columnIndex);
  if (typeof value === "string") {
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}"><v>${String(value)}</v></c>`;
}

function cellRef(rowIndex: number, columnIndex: number): string {
  let column = columnIndex + 1;
  let letters = "";
  while (column > 0) {
    const remainder = (column - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return `${letters}${rowIndex + 1}`;
}

function columnIndexFromReference(reference: string): number {
  const match = reference.match(/^([A-Z]+)[1-9][0-9]*$/i);
  if (!match) throw new Error("invalid spreadsheet cell reference");
  let value = 0;
  for (const char of match[1].toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

function xmlEntry(name: string, xml: string): { name: string; data: Buffer } {
  return { name, data: Buffer.from(xml, "utf8") };
}

function attribute(source: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeXml(match[2]) : null;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric: string | undefined, named: string | undefined) => {
    if (numeric) {
      const codePoint = numeric[0].toLowerCase() === "x" ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) throw new Error("invalid XML character reference");
      return String.fromCodePoint(codePoint);
    }
    switch (named?.toLowerCase()) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return match;
    }
  });
}
