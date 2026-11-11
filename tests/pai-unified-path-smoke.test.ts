import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI unified path smoke", () => {
  it("returns execution result for approved work", async () => {
    const output = await runUnifiedAutonomyPath({
      command: "最後まで進めて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
    }, { execute: async () => ({ ok: true }) });
    assert.deepEqual(output.result, { ok: true });
  });
});
