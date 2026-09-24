import assert from "node:assert/strict";
import test from "node:test";
import { changedPaths, newPathsSinceBaseline, terminalWorkPhase } from "../scripts/zbook-goal-git-status.ts";

test("git porcelain leading status space does not remove the first path character", () => {
  assert.deepEqual(changedPaths(" M src/app/jarvis/OwnerLogin.tsx\n?? scripts/owner-code-windows.ps1\n"), [
    "src/app/jarvis/OwnerLogin.tsx", "scripts/owner-code-windows.ps1",
  ]);
});

test("pre-existing isolated workspace changes are not attributed to this Goal attempt", () => {
  assert.deepEqual(newPathsSinceBaseline(
    ["next-env.d.ts", "tests/fixtures/autonomous-builder-e2e.txt"],
    ["next-env.d.ts", "tests/fixtures/autonomous-builder-e2e.txt", "scripts/owner-code-windows.ps1"],
  ), ["scripts/owner-code-windows.ps1"]);
});

test("Bridge collector waits for a terminal Work Run even after code changes appear", () => {
  for (const phase of [undefined, "QUEUED", "RUNNING", "VERIFY", "RECOVER"]) assert.equal(terminalWorkPhase(phase), false);
  for (const phase of ["COMPLETED", "BLOCKED", "HUMAN_GATE", "FAILED"]) assert.equal(terminalWorkPhase(phase), true);
});
