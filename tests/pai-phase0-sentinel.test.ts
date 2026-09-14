import { describe, expect, it } from "vitest";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter";
import { runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path";

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

    expect(output.decision.canProceed).toBe(true);
    expect(output.result).toMatchObject({ accepted: true });
  });
});
