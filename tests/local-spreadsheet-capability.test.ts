import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeXlsx, LocalSpreadsheetCapability } from "../src/orchestrator/local-spreadsheet-capability.ts";
import type { WorkAction } from "../src/orchestrator/work-capability.ts";

function action(operation: string, path: string, input: Record<string, unknown> = {}): WorkAction {
  return {
    goalId: "g",
    jobId: "j",
    attemptId: "a",
    strategyId: "s",
    capability: "spreadsheet.local",
    domain: "spreadsheet",
    operation,
    input: { path, ...input },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: "spreadsheet.cells_exact", required: true, spec: {} },
  };
}

test("local spreadsheet adapter writes a real OOXML xlsx and round-trips supported cells", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    assert.equal(await capability.available(), true);
    const cells = [
      { sheet: "Summary", cell: "A1", value: "hello & <xlsx>" },
      { sheet: "Summary", cell: "B2", value: 21 },
      { sheet: "Summary", cell: "C2", value: true },
      { sheet: "Summary", cell: "D2", formula: "B2*2", value: 42 },
      { sheet: "Other", cell: "A1", value: null },
    ];

    const written = await capability.execute(action("write", "artifacts/report.xlsx", { workbook: { cells } }));
    assert.equal(written.ok, true);
    assert.match(String(written.outputs.sha256), /^[a-f0-9]{64}$/);
    assert.equal(written.evidence[0]?.kind, "spreadsheet.artifact");

    const bytes = await readFile(join(root, "artifacts/report.xlsx"));
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    const packageText = bytes.toString("latin1");
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]) {
      assert.match(packageText, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const read = await capability.execute(action("read", "artifacts/report.xlsx"));
    assert.equal(read.ok, true);
    assert.deepEqual(read.outputs.workbook, { cells });
    assert.equal(read.outputs.sha256, written.outputs.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local spreadsheet adapter reads an independently deflated OOXML fixture", () => {
  const fixture = Buffer.from("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", "base64");
  assert.deepEqual(decodeXlsx(fixture), {
    cells: [
      { sheet: "ExternalFixture", cell: "A1", value: "from-deflate" },
      { sheet: "ExternalFixture", cell: "B1", value: 42 },
      { sheet: "ExternalFixture", cell: "C1", value: 84, formula: "B1*2" },
    ],
  });
});

test("local spreadsheet adapter is idempotent and blocks conflicting replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-policy-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    const firstCells = [{ sheet: "Sheet1", cell: "A1", value: "original" }];
    const changedCells = [{ sheet: "Sheet1", cell: "A1", value: "different" }];
    const first = await capability.execute(action("write", "result.xlsx", { cells: firstCells }));
    assert.equal(first.ok, true);
    assert.equal(first.changes[0]?.operation, "create");
    const repeated = await capability.execute(action("write", "result.xlsx", { cells: firstCells }));
    assert.equal(repeated.ok, true);
    assert.equal(repeated.outputs.idempotent, true);
    assert.deepEqual(repeated.changes, []);
    const replacement = await capability.execute(action("write", "result.xlsx", { cells: changedCells }));
    assert.equal(replacement.ok, false);
    assert.equal(replacement.status, "blocked");
    assert.equal(replacement.failureClass, "policy");
    assert.equal(replacement.evidence[0]?.kind, "spreadsheet.overwrite_blocked");
    const read = await capability.execute(action("read", "result.xlsx"));
    assert.deepEqual(read.outputs.workbook, { cells: firstCells });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local spreadsheet adapter fails closed on path/symlink escape and malformed workbook", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-xlsx-root-"));
  const outside = await mkdtemp(join(tmpdir(), "jarvis-xlsx-outside-"));
  try {
    const capability = new LocalSpreadsheetCapability(root);
    const cells = [{ sheet: "Sheet1", cell: "A1", value: "safe" }];
    const traversal = await capability.execute(action("write", "../escape.xlsx", { cells }));
    assert.equal(traversal.ok, false);
    assert.match(traversal.error ?? "", /escapes allowed root/);
    await writeFile(join(outside, "outside.xlsx"), Buffer.from("not-an-xlsx"));
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const symlinkRead = await capability.execute(action("read", "escape/outside.xlsx"));
    assert.equal(symlinkRead.ok, false);
    assert.match(symlinkRead.error ?? "", /escapes allowed root/);
    await writeFile(join(root, "broken.xlsx"), Buffer.from("not-an-xlsx"));
    const malformed = await capability.execute(action("read", "broken.xlsx"));
    assert.equal(malformed.ok, false);
    assert.match(malformed.error ?? "", /invalid xlsx zip/);
    const wrongExtension = await capability.execute(action("write", "report.csv", { cells }));
    assert.equal(wrongExtension.ok, false);
    assert.match(wrongExtension.error ?? "", /only supports \.xlsx/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
