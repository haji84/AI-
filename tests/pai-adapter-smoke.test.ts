import { describe, expect, it } from "vitest";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter";

describe("JARVIS adapter smoke", () => {
  it("returns the executor response", async () => {
    const adapter = createJarvisAutonomyAdapter({ enqueueGoal: async () => ({ queued: true }) });
    await expect(adapter.execute({ command: "go", goal: "g", definitionOfDone: ["d"] })).resolves.toEqual({ queued: true });
  });
});
