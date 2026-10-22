import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI nondelegated high risk", () => {
  it("requires approval when completion authority was not granted", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "状態を確認して",
      goal: "Inspect production state",
      definitionOfDone: ["state inspected"],
      riskSignals: { productionDeploy: true },
    });

    assert.equal(decision.authorization, undefined);
    assert.equal(decision.risk.level, "HIGH");
    assert.equal(decision.canProceed, false);
    assert.equal(decision.humanApprovalRequired, true);
  });
});
