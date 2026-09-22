import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalDocumentCapability } from "../src/orchestrator/local-document-capability.ts";
import { LocalSpreadsheetCapability } from "../src/orchestrator/local-spreadsheet-capability.ts";
import {
  WorkCapabilityRegistry,
  type WorkAction,
  type WorkDomain,
} from "../src/orchestrator/work-capability.ts";

function action(
  capability: string,
  domain: WorkDomain,
  operation: "read" | "write",
  path: string,
  input: Record<string, unknown> = {},
): WorkAction {
  return {
    goalId: "dev-pc005-goal",
    jobId: "dev-pc005-job",
    attemptId: `dev-pc005-${capability}-${operation}`,
    strategyId: "bounded-local-office",
    capability,
    domain,
    operation,
    input: { path, ...input },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: `${domain}.semantic-readback`, required: true, spec: {} },
  };
}

test("DEV-PC-005 composes real local DOCX/XLSX capabilities in one bounded registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-dev-pc005-"));
  try {
    const document = new LocalDocumentCapability(root);
    const spreadsheet = new LocalSpreadsheetCapability(root);
    const registry = new WorkCapabilityRegistry().register(document).register(spreadsheet);

    assert.deepEqual(await registry.catalog(), [
      {
        name: "document.local",
        domain: "document",
        operations: ["read", "write"],
        access: "write",
        externalSideEffect: false,
        maxRisk: "low",
        requiresHumanApproval: false,
        available: true,
      },
      {
        name: "spreadsheet.local",
        domain: "spreadsheet",
        operations: ["read", "write"],
        access: "write",
        externalSideEffect: false,
        maxRisk: "low",
        requiresHumanApproval: false,
        available: true,
      },
    ]);

    const expectedDocument = {
      title: "JARVIS Office Evidence",
      sections: {
        Summary: "bounded local Office capability",
        Verification: "persisted artifact is independently decoded after write",
      },
    };
    const expectedWorkbook = {
      cells: [
        { sheet: "Evidence", cell: "A1", value: "Requirement" },
        { sheet: "Evidence", cell: "B1", value: "DEV-PC-005" },
        { sheet: "Evidence", cell: "A2", value: "Count" },
        { sheet: "Evidence", cell: "B2", value: 2 },
        { sheet: "Evidence", cell: "C2", value: true },
      ],
    };

    const docWrite = await document.execute(action(
      "document.local",
      "document",
      "write",
      "office/report.docx",
      { document: expectedDocument },
    ));
    const sheetWrite = await spreadsheet.execute(action(
      "spreadsheet.local",
      "spreadsheet",
      "write",
      "office/evidence.xlsx",
      { workbook: expectedWorkbook },
    ));

    assert.equal(docWrite.ok, true);
    assert.equal(sheetWrite.ok, true);
    assert.match(String(docWrite.outputs.sha256), /^[a-f0-9]{64}$/);
    assert.match(String(sheetWrite.outputs.sha256), /^[a-f0-9]{64}$/);
    assert.equal(docWrite.evidence[0]?.kind, "document.artifact");
    assert.equal(sheetWrite.evidence[0]?.kind, "spreadsheet.artifact");

    const docRead = await registry.get("document.local")!.execute(action(
      "document.local",
      "document",
      "read",
      "office/report.docx",
    ));
    const sheetRead = await registry.get("spreadsheet.local")!.execute(action(
      "spreadsheet.local",
      "spreadsheet",
      "read",
      "office/evidence.xlsx",
    ));

    assert.equal(docRead.ok, true);
    assert.equal(sheetRead.ok, true);
    assert.deepEqual(docRead.outputs.document, expectedDocument);
    assert.deepEqual(sheetRead.outputs.workbook, expectedWorkbook);
    assert.equal(docRead.outputs.sha256, docWrite.outputs.sha256);
    assert.equal(sheetRead.outputs.sha256, sheetWrite.outputs.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DEV-PC-005 Office writes are idempotent and conflicting replacement stays fail-closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-dev-pc005-policy-"));
  try {
    const document = new LocalDocumentCapability(root);
    const spreadsheet = new LocalSpreadsheetCapability(root);
    const doc = { title: "Stable", sections: { Body: "one" } };
    const workbook = { cells: [{ sheet: "Sheet1", cell: "A1", value: "one" }] };

    assert.equal((await document.execute(action("document.local", "document", "write", "stable.docx", { document: doc }))).ok, true);
    assert.equal((await spreadsheet.execute(action("spreadsheet.local", "spreadsheet", "write", "stable.xlsx", { workbook }))).ok, true);

    const docRepeat = await document.execute(action("document.local", "document", "write", "stable.docx", { document: doc }));
    const sheetRepeat = await spreadsheet.execute(action("spreadsheet.local", "spreadsheet", "write", "stable.xlsx", { workbook }));
    assert.equal(docRepeat.ok, true);
    assert.equal(docRepeat.outputs.idempotent, true);
    assert.deepEqual(docRepeat.changes, []);
    assert.equal(sheetRepeat.ok, true);
    assert.equal(sheetRepeat.outputs.idempotent, true);
    assert.deepEqual(sheetRepeat.changes, []);

    const docConflict = await document.execute(action(
      "document.local",
      "document",
      "write",
      "stable.docx",
      { document: { title: "Stable", sections: { Body: "two" } } },
    ));
    const sheetConflict = await spreadsheet.execute(action(
      "spreadsheet.local",
      "spreadsheet",
      "write",
      "stable.xlsx",
      { workbook: { cells: [{ sheet: "Sheet1", cell: "A1", value: "two" }] } },
    ));

    for (const result of [docConflict, sheetConflict]) {
      assert.equal(result.ok, false);
      assert.equal(result.status, "blocked");
      assert.equal(result.failureClass, "policy");
      assert.match(result.error ?? "", /overwrite requires an approved replacement path/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DEV-PC-005 rejects path escape and unsupported Office/file extensions", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-dev-pc005-boundary-"));
  try {
    const document = new LocalDocumentCapability(root);
    const spreadsheet = new LocalSpreadsheetCapability(root);

    const docEscape = await document.execute(action(
      "document.local",
      "document",
      "write",
      "../escape.docx",
      { document: { title: "x", sections: {} } },
    ));
    const sheetEscape = await spreadsheet.execute(action(
      "spreadsheet.local",
      "spreadsheet",
      "write",
      "../escape.xlsx",
      { workbook: { cells: [] } },
    ));
    assert.equal(docEscape.ok, false);
    assert.equal(sheetEscape.ok, false);
    assert.match(docEscape.error ?? "", /escapes allowed root/);
    assert.match(sheetEscape.error ?? "", /escapes allowed root/);

    const macroDoc = await document.execute(action(
      "document.local",
      "document",
      "write",
      "macro.docm",
      { document: { title: "x", sections: {} } },
    ));
    const macroSheet = await spreadsheet.execute(action(
      "spreadsheet.local",
      "spreadsheet",
      "write",
      "macro.xlsm",
      { workbook: { cells: [] } },
    ));
    const presentation = await document.execute(action(
      "document.local",
      "document",
      "write",
      "slides.pptx",
      { document: { title: "not supported", sections: {} } },
    ));

    assert.equal(macroDoc.ok, false);
    assert.equal(macroSheet.ok, false);
    assert.equal(presentation.ok, false);
    assert.match(macroDoc.error ?? "", /only supports \.docx paths/);
    assert.match(macroSheet.error ?? "", /only supports \.xlsx paths/);
    assert.match(presentation.error ?? "", /only supports \.docx paths/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
