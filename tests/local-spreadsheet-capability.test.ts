import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSpreadsheetCapability } from "../src/orchestrator/local-spreadsheet-capability.ts";
import { createOoxmlZip, readOoxmlZip } from "../src/orchestrator/ooxml-zip.ts";
import type { WorkAction } from "../src/orchestrator/work-capability.ts";

function action(operation: string, path: string, rows?: unknown): WorkAction {
  return {
    goalId: "g",
    jobId: "j",
    attemptId: "a",
    strategyId: "s",
    capability: "spreadsheet.local",
    domain: "spreadsheet",
    operation,
    input: { path, rows },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: "spreadsheet", required: true, spec: {} },
  };
}

test("local spreadsheet adapter creates a real XLSX and round-trips primitive cells", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    const rows = [
      ["name", "count", "enabled", "formula-looking"],
      ["alpha & <beta>", 42.5, true, "=SUM(A1:A2)"],
      ["", -7, false, null],
    ];

    const written = await capability.execute(action("write", "reports/data.xlsx", rows));
    assert.equal(written.ok, true);
    assert.equal(written.outputs.rowCount, 3);
    assert.equal(written.outputs.columnCount, 4);
    assert.match(String(written.outputs.sha256), /^[a-f0-9]{64}$/);

    const bytes = await readFile(join(root, "reports/data.xlsx"));
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    const entries = readOoxmlZip(bytes);
    assert.ok(entries.has("[Content_Types].xml"));
    assert.ok(entries.has("xl/workbook.xml"));
    assert.ok(entries.has("xl/worksheets/sheet1.xml"));
    assert.match(entries.get("xl/worksheets/sheet1.xml")!.toString("utf8"), /t="inlineStr"/);
    assert.doesNotMatch(entries.get("xl/worksheets/sheet1.xml")!.toString("utf8"), /<f[ >]/);

    const read = await capability.execute(action("read", "reports/data.xlsx"));
    assert.equal(read.ok, true);
    assert.deepEqual(read.outputs.rows, [rows[0], rows[1], ["", -7, false]]);
    assert.equal(read.outputs.sha256, written.outputs.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local spreadsheet adapter accepts shared-string XLSX input", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-shared-"));
  try {
    const workbook = createOoxmlZip([
      xml("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
      xml("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Imported" sheetId="1" r:id="rId7"/></sheets></workbook>`),
      xml("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/import.xml"/></Relationships>`),
      xml("xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Hello &amp; world</t></si><si><r><t>rich</t></r><r><t> text</t></r></si></sst>`),
      xml("xl/worksheets/import.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>12.25</v></c><c r="D1" t="b"><v>1</v></c></row></sheetData></worksheet>`),
    ]);
    await writeFile(join(root, "import.xlsx"), workbook);

    const result = await new LocalSpreadsheetCapability(root).execute(action("read", "import.xlsx"));
    assert.equal(result.ok, true);
    assert.deepEqual(result.outputs.rows, [["Hello & world", "rich text", 12.25, true]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local spreadsheet adapter is idempotent and blocks conflicting replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-conflict-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    const first = await capability.execute(action("write", "result.xlsx", [["one"]]));
    assert.equal(first.ok, true);
    assert.equal(first.changes[0]?.operation, "create");

    const repeat = await capability.execute(action("write", "result.xlsx", [["one"]]));
    assert.equal(repeat.ok, true);
    assert.equal(repeat.outputs.idempotent, true);
    assert.deepEqual(repeat.changes, []);

    const conflict = await capability.execute(action("write", "result.xlsx", [["two"]]));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.status, "blocked");
    assert.equal(conflict.failureClass, "policy");
    assert.equal(conflict.evidence[0]?.kind, "spreadsheet.overwrite_blocked");

    const read = await capability.execute(action("read", "result.xlsx"));
    assert.deepEqual(read.outputs.rows, [["one"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local spreadsheet adapter rejects traversal, symlink escape, wrong extension and DTD", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-root-"));
  const outside = await mkdtemp(join(tmpdir(), "jarvis-xlsx-outside-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    assert.equal((await capability.execute(action("write", "../escape.xlsx", [[1]]))).ok, false);
    assert.equal((await capability.execute(action("write", "not-a-sheet.txt", [[1]]))).ok, false);

    await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    const escaped = await capability.execute(action("write", "link/escape.xlsx", [[1]]));
    assert.equal(escaped.ok, false);
    await assert.rejects(readFile(join(outside, "escape.xlsx")));

    const dtdWorkbook = createOoxmlZip([
      xml("[Content_Types].xml", `<?xml version="1.0"?><Types/>`),
      xml("xl/workbook.xml", `<?xml version="1.0"?><!DOCTYPE workbook [<!ENTITY x "boom">]><workbook><sheets><sheet r:id="rId1"/></sheets></workbook>`),
      xml("xl/_rels/workbook.xml.rels", `<Relationships/>`),
    ]);
    await writeFile(join(root, "dtd.xlsx"), dtdWorkbook);
    const dtd = await capability.execute(action("read", "dtd.xlsx"));
    assert.equal(dtd.ok, false);
    assert.match(dtd.error ?? "", /DTD\/entity/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("OOXML ZIP reader fails closed on corruption", () => {
  const archive = createOoxmlZip([xml("safe.xml", "<safe>payload</safe>")]);
  const corrupted = Buffer.from(archive);
  const marker = Buffer.from("safe.xml");
  const localName = corrupted.indexOf(marker);
  assert.ok(localName > 0);
  const dataOffset = localName + marker.length;
  corrupted[dataOffset] ^= 0xff;
  assert.throws(() => readOoxmlZip(corrupted));
});

function xml(name: string, value: string): { name: string; data: Buffer } {
  return { name, data: Buffer.from(value, "utf8") };
}
