import { describe, expect, it, vi } from "vitest";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter";

describe("JARVIS unified autonomy adapter", () => {
  it("passes goal, DoD, target and authorization scope into JARVIS execution", async () => {
    const enqueueGoal = vi.fn(async () => ({ id: "task-42" }));
    const adapter = createJarvisAutonomyAdapter({ enqueueGoal });

    const result = await adapter.execute({
      command: "最後まで進めて",
      goal: "Finish the work",
      definitionOfDone: ["verified complete"],
      targetNodeId: "android-1",
      authorization: {
        kind: "task_completion",
        scopeId: "issue:42",
        allowLowMediumMainMerge: true,
        allowProductionDeploy: true,
        issuedBy: "owner",
        issuedAt: new Date("2026-09-15T00:00:00Z").toISOString(),
        expiresAt: new Date("2026-09-22T00:00:00Z").toISOString(),
      },
    });

    expect(enqueueGoal).toHaveBeenCalledWith({
      command: "最後まで進めて",
      goal: "Finish the work",
      definitionOfDone: ["verified complete"],
      targetNodeId: "android-1",
      authorizationScopeId: "issue:42",
    });
    expect(result).toEqual({ id: "task-42" });
  });
});
