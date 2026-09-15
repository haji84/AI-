import { describe, expect, it } from "vitest";
import { runDynamicMultiAgentGoal } from "../src/orchestrator/dynamic-multi-agent-runtime.ts";
import { TeamMemory } from "../src/orchestrator/team-organizational-memory.ts";
import type { CapabilityExecutor, GoalDrivenLoop } from "../src/orchestrator/goal-loop.ts";

const goal = {
  id: "g17",
  title: "research and verify",
  successCriteria: ["research result verified"],
  constraints: [],
};

const executor: CapabilityExecutor = {
  async execute() { return { ok: true, summary: "done" }; },
};

function loop(): GoalDrivenLoop {
  return {
    async run() {
      return { stopReason: "goal_complete", cycles: [] } as never;
    },
  } as GoalDrivenLoop;
}

describe("dynamic multi-agent runtime", () => {
  it("assembles deterministic registered roles without inventing capabilities", async () => {
    const report = await runDynamicMultiAgentGoal({
      goal,
      availableCapabilities: [
        { name: "verify", roles: ["verifier"], matchTerms: ["verify"] },
        { name: "research", roles: ["researcher"], matchTerms: ["research"] },
      ],
      memory: new TeamMemory(), executor, createLoop: loop,
    });
    expect(report.blockedReason).toBeUndefined();
    expect(report.agents.map((a) => a.capability)).toEqual(["research", "verify"]);
  });

  it("blocks visibly when a required capability is unavailable", async () => {
    const report = await runDynamicMultiAgentGoal({
      goal,
      availableCapabilities: [{ name: "research", roles: ["researcher"] }],
      requirements: [{ role: "verifier", capability: "verify", reason: "DoD", required: true }],
      memory: new TeamMemory(), executor, createLoop: loop,
    });
    expect(report.blockedReason).toBe("missing_required_capabilities:verify");
    expect(report.run).toBeNull();
  });

  it("enforces the task-scoped agent budget", async () => {
    const report = await runDynamicMultiAgentGoal({
      goal,
      availableCapabilities: [
        { name: "research", roles: ["researcher"], matchTerms: ["research"] },
        { name: "verify", roles: ["verifier"], matchTerms: ["verify"] },
      ],
      memory: new TeamMemory(), executor, createLoop: loop, maxAgents: 1,
    });
    expect(report.blockedReason).toBe("dynamic_agent_budget_exhausted:2>1");
    expect(report.memoryUpdated).toBe(false);
  });
});
