import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("unified autonomy safety contract", () => {
  it("does not treat a generic command as production delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "これ確認して",
      goal: "Inspect current state",
      definitionOfDone: ["state inspected"],
      riskSignals: { productionDeploy: true },
    });

    expect(decision.risk.level).toBe("HIGH");
    expect(decision.canProceed).toBe(false);
    expect(decision.humanApprovalRequired).toBe(true);
  });

  it("keeps critical policy changes blocked even under completion delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "完成まで全部任せる",
      goal: "Complete the task",
      definitionOfDone: ["task completed"],
      riskSignals: { humanGatePolicyRelaxation: true },
    });

    expect(decision.authorization).toBeDefined();
    expect(decision.risk.level).toBe("CRITICAL");
    expect(decision.canProceed).toBe(false);
  });
});
