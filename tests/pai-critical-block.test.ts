import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI critical execution block", () => {
  it("blocks unrecoverable destruction regardless of completion delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "全部最後まで任せる",
      goal: "Complete requested work",
      definitionOfDone: ["verified complete"],
      riskSignals: { unrecoverableProductionDestruction: true },
    });
    expect(decision.canProceed).toBe(false);
    expect(decision.blocker).toBe("risk:critical");
  });
});
