import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI medium-risk autonomy", () => {
  it("uses completion delegation for main merge", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
      riskSignals: { mainMerge: true },
    });
    assert.equal(decision.canProceed, true);
  });
});
