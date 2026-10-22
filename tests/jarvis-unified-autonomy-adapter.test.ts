import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createJarvisAutonomyAdapter } from "../src/jarvis/unified-autonomy-adapter.ts";

describe("JARVIS unified autonomy adapter", () => {
  it("passes goal, DoD, target and authorization scope into JARVIS execution", async () => {
    const enqueueGoal = mock.fn(async (input: {
      command: string;
      goal: string;
      definitionOfDone: string[];
      targetNodeId?: string;
      authorizationScopeId?: string;
    }) => (void input, { id: "task-42" }));
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

    assert.deepEqual(enqueueGoal.mock.calls[0]?.arguments[0], {
      command: "最後まで進めて",
      goal: "Finish the work",
      definitionOfDone: ["verified complete"],
      targetNodeId: "android-1",
      authorizationScopeId: "issue:42",
    });
    assert.deepEqual(result, { id: "task-42" });
  });
});
