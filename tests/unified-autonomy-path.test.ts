import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { buildUnifiedAutonomyDecision, runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path.ts";

describe("unified autonomy path", () => {
  it("allows ordinary low-risk work without human approval", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "この仕事やってて",
      goal: "Finish the assigned work",
      definitionOfDone: ["requested work is completed", "result is verified"],
    });

    assert.equal(decision.risk.level, "LOW");
    assert.equal(decision.canProceed, true);
    assert.equal(decision.humanApprovalRequired, false);
  });

  it("uses task-completion delegation to continue medium-risk work", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete the task",
      definitionOfDone: ["task reaches completion"],
      riskSignals: { mainMerge: true },
    });

    assert.equal(decision.authorization?.allowLowMediumMainMerge, true);
    assert.equal(decision.risk.level, "MEDIUM");
    assert.equal(decision.canProceed, true);
  });

  it("never bypasses critical risk blocks", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete the task",
      definitionOfDone: ["task reaches completion"],
      riskSignals: { protectionOrAuditDisable: true },
    });

    assert.equal(decision.risk.level, "CRITICAL");
    assert.equal(decision.canProceed, false);
    assert.equal(decision.blocker, "risk:critical");
  });

  it("hands approved work to the JARVIS adapter", async () => {
    const execute = mock.fn(async (input: {
      command: string;
      goal: string;
      definitionOfDone: string[];
      targetNodeId?: string;
      authorization?: unknown;
    }) => (void input, { taskId: "task-1", status: "queued" }));

    const output = await runUnifiedAutonomyPath({
      command: "最後まで進めて",
      goal: "Complete work on the selected device",
      definitionOfDone: ["device task completed", "completion verified"],
      targetNodeId: "android-1",
    }, { execute });

    assert.equal(output.decision.canProceed, true);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(execute.mock.calls[0]?.arguments[0].targetNodeId, "android-1");
    assert.equal(execute.mock.calls[0]?.arguments[0].goal, "Complete work on the selected device");
    assert.deepEqual(output.result, { taskId: "task-1", status: "queued" });
  });
});
