import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI low-risk autonomy", () => {
  it("proceeds autonomously", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "この仕事やってて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
    });
    assert.equal(decision.canProceed, true);
  });
});
