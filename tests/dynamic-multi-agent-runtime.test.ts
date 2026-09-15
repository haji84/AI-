import assert from "node:assert/strict";
import test from "node:test";
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

test("assembles deterministic registered roles without inventing capabilities", async () => {
  const report = await runDynamicMultiAgentGoal({
    goal,
    availableCapabilities: [
      { name: "verify", roles: ["verifier"], matchTerms: ["verify"] },
      { name: "research", roles: ["researcher"], matchTerms: ["research"] },
    ],
    memory: new TeamMemory(), executor, createLoop: loop,
  });
  assert.equal(report.blockedReason, undefined);
  assert.deepEqual(report.agents.map((a) => a.capability), ["research", "verify"]);
});

test("blocks visibly when a required capability is unavailable", async () => {
  const report = await runDynamicMultiAgentGoal({
    goal,
    availableCapabilities: [{ name: "research", roles: ["researcher"] }],
    requirements: [{ role: "verifier", capability: "verify", reason: "DoD", required: true }],
    memory: new TeamMemory(), executor, createLoop: loop,
  });
  assert.equal(report.blockedReason, "missing_required_capabilities:verify");
  assert.equal(report.run, null);
});

test("enforces the task-scoped agent budget", async () => {
  const report = await runDynamicMultiAgentGoal({
    goal,
    availableCapabilities: [
      { name: "research", roles: ["researcher"], matchTerms: ["research"] },
      { name: "verify", roles: ["verifier"], matchTerms: ["verify"] },
    ],
    memory: new TeamMemory(), executor, createLoop: loop, maxAgents: 1,
  });
  assert.equal(report.blockedReason, "dynamic_agent_budget_exhausted:2>1");
  assert.equal(report.memoryUpdated, false);
});
