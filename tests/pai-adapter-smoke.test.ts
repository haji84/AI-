import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter.ts";

describe("JARVIS adapter smoke", () => {
  it("returns the executor response", async () => {
    const adapter = createJarvisAutonomyAdapter({ enqueueGoal: async () => ({ queued: true }) });
    assert.deepEqual(await adapter.execute({ command: "go", goal: "g", definitionOfDone: ["d"] }), { queued: true });
  });
});
