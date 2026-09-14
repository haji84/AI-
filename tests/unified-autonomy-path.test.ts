import { describe, expect, it, vi } from "vitest";
import { buildUnifiedAutonomyDecision, runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path";

describe("unified autonomy path", () => {
  it("allows ordinary low-risk work without human approval", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "この仕事やってて",
      goal: "Finish the assigned work",
      definitionOfDone: ["requested work is completed", "result is verified"],
    });

    expect(decision.risk.level).toBe("LOW");
    expect(decision.canProceed).toBe(true);
    expect(decision.humanApprovalRequired).toBe(false);
  });

  it("uses task-completion delegation to continue medium-risk work", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete the task",
      definitionOfDone: ["task reaches completion"],
      riskSignals: { mainMerge: true },
    });

    expect(decision.authorization?.allowLowMediumMainMerge).toBe(true);
    expect(decision.risk.level).toBe("MEDIUM");
    expect(decision.canProceed).toBe(true);
  });

  it("never bypasses critical risk blocks", () => {
    const decision = buildUnifiedAutonomyDecision({
      command: "最後まで進めて",
      goal: "Complete the task",
      definitionOfDone: ["task reaches completion"],
      riskSignals: { protectionOrAuditDisable: true },
    });

    expect(decision.risk.level).toBe("CRITICAL");
    expect(decision.canProceed).toBe(false);
    expect(decision.blocker).toBe("risk:critical");
  });

  it("hands approved work to the JARVIS adapter", async () => {
    const execute = vi.fn(async () => ({ taskId: "task-1", status: "queued" }));

    const output = await runUnifiedAutonomyPath({
      command: "最後まで進めて",
      goal: "Complete work on the selected device",
      definitionOfDone: ["device task completed", "completion verified"],
      targetNodeId: "android-1",
    }, { execute });

    expect(output.decision.canProceed).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      targetNodeId: "android-1",
      goal: "Complete work on the selected device",
    }));
    expect(output.result).toEqual({ taskId: "task-1", status: "queued" });
  });
});
