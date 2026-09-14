import { describe, expect, it } from "vitest";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path";

describe("PAI delegated risk matrix", () => {
  it.each([
    [{}, "LOW", true],
    [{ mainMerge: true }, "MEDIUM", true],
    [{ productionDeploy: true }, "HIGH", true],
    [{ protectionOrAuditDisable: true }, "CRITICAL", false],
  ] as const)("maps %o to %s", (riskSignals, level, canProceed) => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete requested work",
      definitionOfDone: ["verified complete"],
      riskSignals,
    });
    expect(decision.risk.level).toBe(level);
    expect(decision.canProceed).toBe(canProceed);
  });
});
