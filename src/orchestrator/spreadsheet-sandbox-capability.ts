import type { WorkAction, WorkCapability, WorkResult, WorkVerifierContract } from "./work-capability.ts";

export interface SpreadsheetCell {
  sheet: string;
  cell: string;
  value?: string | number | boolean | null;
  formula?: string;
}

export interface SpreadsheetWorkbook {
  cells: SpreadsheetCell[];
}

function key(cell: Pick<SpreadsheetCell, "sheet" | "cell">) {
  return `${cell.sheet}!${cell.cell}`;
}

export class SpreadsheetSandboxCapability implements WorkCapability {
  private readonly workbook: SpreadsheetWorkbook;
  readonly name = "spreadsheet.write";
  readonly domain = "spreadsheet" as const;
  readonly operations = ["set_cells"];
  readonly access = "write" as const;
  readonly externalSideEffect = false;
  readonly maxRisk = "low" as const;
  readonly requiresHumanApproval = false;

  constructor(workbook: SpreadsheetWorkbook) { this.workbook = workbook; }

  async available() { return true; }

  async execute(action: WorkAction): Promise<WorkResult> {
    if (action.operation !== "set_cells") {
      return this.failure(action, "unsupported_operation", "implementation");
    }
    const cells = action.input.cells;
    if (!Array.isArray(cells)) return this.failure(action, "cells must be an array", "implementation");
    const changed: string[] = [];
    for (const raw of cells) {
      if (!raw || typeof raw !== "object") continue;
      const next = raw as SpreadsheetCell;
      if (!next.sheet || !next.cell) continue;
      const existing = this.workbook.cells.find((item) => key(item) === key(next));
      if (existing) Object.assign(existing, next);
      else this.workbook.cells.push({ ...next });
      changed.push(key(next));
    }
    return {
      ok: true,
      status: "completed",
      outputs: { workbook: structuredClone(this.workbook) },
      changes: changed.map((resource) => ({ resource, operation: "set", reversible: true, rollbackHint: "restore sandbox fixture" })),
      evidence: [{ kind: "spreadsheet.snapshot", data: structuredClone(this.workbook) }],
      provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
    };
  }

  private failure(action: WorkAction, error: string, failureClass: WorkResult["failureClass"]): WorkResult {
    return {
      ok: false, status: "failed", outputs: {}, changes: [], evidence: [], failureClass, error,
      provenance: { capability: this.name, attemptId: action.attemptId, strategyId: action.strategyId },
    };
  }
}

export interface SpreadsheetVerification {
  ok: boolean;
  summary: string;
  evidence: Record<string, unknown>;
}

export function verifySpreadsheet(workbook: SpreadsheetWorkbook, contract: WorkVerifierContract): SpreadsheetVerification {
  if (contract.kind !== "spreadsheet.cells_exact") {
    return { ok: false, summary: "unsupported spreadsheet verifier", evidence: { kind: contract.kind } };
  }
  const expected = Array.isArray(contract.spec.cells) ? contract.spec.cells as SpreadsheetCell[] : [];
  const actual = new Map(workbook.cells.map((cell) => [key(cell), cell]));
  const mismatches: Array<{ resource: string; reason: string; expected: unknown; actual?: unknown }> = [];\n  for (const cell of expected) {
    const found = actual.get(key(cell));
    if (!found) return [{ resource: key(cell), reason: "missing", expected: cell }];
    if (cell.formula !== undefined && found.formula !== cell.formula) return [{ resource: key(cell), reason: "formula", expected: cell.formula, actual: found.formula }];
    if (cell.value !== undefined && found.value !== cell.value) return [{ resource: key(cell), reason: "value", expected: cell.value, actual: found.value }];
    return [];
  });
  return {
    ok: mismatches.length === 0,
    summary: mismatches.length === 0 ? "spreadsheet verification passed" : `spreadsheet verification failed: ${mismatches.length} mismatch(es)`,
    evidence: { kind: "spreadsheet.cells_exact", mismatches, expected },
  };
}
