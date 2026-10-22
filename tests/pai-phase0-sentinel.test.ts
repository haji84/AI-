import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter.ts";
import { runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path.ts";

describe("PAI phase 0 integration sentinel", () => {
  it("supports Commander-style completion intent through the JARVIS adapter boundary", async () => {
    const adapter = createJarvisAutonomyAdapter({
      enqueueGoal: async (input) => ({ accepted: true, input }),
    });

    const output = await runUnifiedAutonomyPath({
      command: "この仕事を最後まで進めて",
      goal: "Complete requested work",
      definitionOfDone: ["result produced", "result verified"],
    }, adapter);

    assert.equal(output.decision.canProceed, true);
    assert.equal(output.result?.accepted, true);
  });
});
