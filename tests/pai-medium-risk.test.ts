import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI medium-risk autonomy", () => {
  it("uses completion delegation for main merge", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
      riskSignals: { mainMerge: true },
    });
    expect(decision.canProceed).toBe(true);
  });
});
