import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI low-risk autonomy", () => {
  it("proceeds autonomously", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "この仕事やってて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
    });
    expect(decision.canProceed).toBe(true);
  });
});
