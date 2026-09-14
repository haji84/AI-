import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI scoped high-risk delegation", () => {
  it("allows production deploy only when completion authority is explicitly inferred", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "本番反映まで最後まで進めて",
      goal: "Complete and deploy requested work",
      definitionOfDone: ["production result verified"],
      riskSignals: { productionDeploy: true },
    });
    expect(decision.authorization?.allowProductionDeploy).toBe(true);
    expect(decision.canProceed).toBe(true);
  });
});
