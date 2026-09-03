import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectState } from "../src/dashboard/project-state.ts";

test("PROJECT_STATEの主要項目をダッシュボード用に読み取れる", () => {
  const state = parseProjectState(`
PROJECT: Unified AI Creator Studio
CURRENT_PHASE: Phase 3
STATUS: PHASE_3_REAL_MACHINE_SMOKE_PENDING
LAST_UPDATED: 2026-09-02
CURRENT_EPIC: Image editing
ACTIVE_ISSUES: #78
BLOCKERS: smoke evidence required
NEXT_PRIORITY: run smoke test
LAST_SUCCESSFUL_CI: CI run #110 succeeded
COMPASS_MCP: v1 verified PASS
`);

  assert.equal(state.phase, "Phase 3");
  assert.equal(state.activeIssues, "#78");
  assert.equal(state.blocker, "smoke evidence required");
  assert.equal(state.compass, "v1 verified PASS");
});
