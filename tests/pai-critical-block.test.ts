import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUnifiedAutonomyDecision } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI critical execution block", () => {
  it("blocks unrecoverable destruction regardless of completion delegation", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "全部最後まで任せる",
      goal: "Complete requested work",
      definitionOfDone: ["verified complete"],
      riskSignals: { unrecoverableProductionDestruction: true },
    });
    assert.equal(decision.canProceed, false);
    assert.equal(decision.blocker, "risk:critical");
  });
});
