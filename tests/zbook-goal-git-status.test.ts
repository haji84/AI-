import assert from "node:assert/strict";
import test from "node:test";
import { changedPaths } from "../scripts/zbook-goal-git-status.ts";

test("git porcelain leading status space does not remove the first path character", () => {
  assert.deepEqual(changedPaths(" M src/app/jarvis/OwnerLogin.tsx\n?? scripts/owner-code-windows.ps1\n"), [
    "src/app/jarvis/OwnerLogin.tsx", "scripts/owner-code-windows.ps1",
  ]);
});
