import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI delegated risk matrix", () => {
  for (const [riskSignals, level, canProceed] of [
    [{}, "LOW", true],
    [{ mainMerge: true }, "MEDIUM", true],
    [{ productionDeploy: true }, "HIGH", true],
    [{ protectionOrAuditDisable: true }, "CRITICAL", false],
  ] as const) {
    it(`maps ${JSON.stringify(riskSignals)} to ${level}`, () => {
      const decision = buildUnifiedAutonomyDecision({
        command: "最後まで進めて",
        goal: "Complete requested work",
        definitionOfDone: ["verified complete"],
        riskSignals,
      });
      assert.equal(decision.risk.level, level);
      assert.equal(decision.canProceed, canProceed);
    });
  }
});
