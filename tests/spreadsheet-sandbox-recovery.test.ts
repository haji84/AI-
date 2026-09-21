import assert from "node:assert/strict";
import test from "node:test";
import { SpreadsheetSandboxCapability, verifySpreadsheet, type SpreadsheetWorkbook } from "../src/orchestrator/spreadsheet-sandbox-capability.ts";
import type { WorkAction, WorkVerifierContract } from "../src/orchestrator/work-capability.ts";

const contract: WorkVerifierContract = {
  kind: "spreadsheet.cells_exact",
  required: true,
  spec: { cells: [
    { sheet: "Summary", cell: "B2", value: 30 },
    { sheet: "Summary", cell: "B3", formula: "=SUM(Data!B2:B4)" },
  ] },
};

function action(strategyId: string, cells: unknown[]): WorkAction {
  return {
    goalId: "goal-sheet-1", jobId: "job-sheet-1", attemptId: `attempt-${strategyId}`, strategyId,
    capability: "spreadsheet.write", domain: "spreadsheet", operation: "set_cells",
    input: { cells }, scope: [{ kind: "workbook", ids: ["sandbox.xlsx"] }],
    expectedOutputs: ["verified workbook"], risk: "low", access: "write", externalSideEffect: false,
    irreversible: false, idempotencyKey: `sheet-${strategyId}`, verifier: contract,
  };
}

test("spreadsheet sandbox proves FAIL -> evidence -> recovery -> PASS", async () => {
  const workbook: SpreadsheetWorkbook = { cells: [
    { sheet: "Data", cell: "B2", value: 10 },
    { sheet: "Data", cell: "B3", value: 10 },
    { sheet: "Data", cell: "B4", value: 10 },
  ] };
  const capability = new SpreadsheetSandboxCapability(workbook);

  const first = await capability.execute(action("initial", [
    { sheet: "Summary", cell: "B2", value: 20 },
    { sheet: "Summary", cell: "B3", formula: "=SUM(Data!B2:B3)" },
  ]));
  assert.equal(first.ok, true);
  const failed = verifySpreadsheet(workbook, contract);
  assert.equal(failed.ok, false);
  const mismatches = failed.evidence.mismatches as Array<{ resource: string; expected: unknown }>;
  assert.equal(mismatches.length, 2);

  // Recovery is driven by verifier evidence produced after the initial attempt.
  const expected = failed.evidence.expected as Array<Record<string, unknown>>;
  const recovered = await capability.execute(action("recovery-1", expected));
  assert.equal(recovered.ok, true);
  const passed = verifySpreadsheet(workbook, contract);
  assert.equal(passed.ok, true);
  assert.equal(workbook.cells.find((cell) => cell.cell === "B2" && cell.sheet === "Summary")?.value, 30);
  assert.equal(workbook.cells.find((cell) => cell.cell === "B3" && cell.sheet === "Summary")?.formula, "=SUM(Data!B2:B4)");
});
