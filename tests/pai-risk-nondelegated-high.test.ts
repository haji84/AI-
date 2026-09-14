import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI nondelegated high risk", () => {
  it("requires approval when completion authority was not granted", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "状態を確認して",
      goal: "Inspect production state",
      definitionOfDone: ["state inspected"],
      riskSignals: { productionDeploy: true },
    });

    expect(decision.authorization).toBeUndefined();
    expect(decision.risk.level).toBe("HIGH");
    expect(decision.canProceed).toBe(false);
    expect(decision.humanApprovalRequired).toBe(true);
  });
});
