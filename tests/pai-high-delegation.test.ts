import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI scoped high-risk delegation", () => {
  it("allows production deploy only when completion authority is explicitly inferred", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "本番反映まで最後まで進めて",
      goal: "Complete and deploy requested work",
      definitionOfDone: ["production result verified"],
      riskSignals: { productionDeploy: true },
    });
    assert.equal(decision.authorization?.allowProductionDeploy, true);
    assert.equal(decision.canProceed, true);
  });
});
