import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("unified autonomy safety contract", () => {
  it("does not treat a generic command as production delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "これ確認して",
      goal: "Inspect current state",
      definitionOfDone: ["state inspected"],
      riskSignals: { productionDeploy: true },
    });

    assert.equal(decision.risk.level, "HIGH");
    assert.equal(decision.canProceed, false);
    assert.equal(decision.humanApprovalRequired, true);
  });

  it("keeps critical policy changes blocked even under completion delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "完成まで全部任せる",
      goal: "Complete the task",
      definitionOfDone: ["task completed"],
      riskSignals: { humanGatePolicyRelaxation: true },
    });

    assert.notEqual(decision.authorization, undefined);
    assert.equal(decision.risk.level, "CRITICAL");
    assert.equal(decision.canProceed, false);
  });
});
