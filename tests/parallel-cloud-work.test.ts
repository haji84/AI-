import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CloudCompassStateStoreAdapter } from "../src/orchestrator/cloud-runtime.ts";
import { ModelBackedPlanner, parallelCloudCandidates, type PlanningModel } from "../src/orchestrator/model-planner.ts";
import type { ContextItem, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Advance repository",
  successCriteria: ["verified"],
  constraints: ["keep Human Gate"],
};

function context(openIssues: unknown[]): ContextItem[] {
  return [
    {
      source: "repository.file:PROJECT_STATE.md",
      summary: "STATUS: PHASE_3_REAL_MACHINE_SMOKE_PENDING\nNEXT_PRIORITY: Run actual local ComfyUI Qwen-Image-Edit smoke on workstation",
    },
    {
      source: "github.repository_state",
      summary: "GitHub repository state collected",
      data: { available: true, openIssues },
    },
  ];
}

test("parallel candidates exclude local-only issues and pull requests", () => {
  const candidates = parallelCloudCandidates(context([
    { number: 78, title: "Run Qwen-Image-Edit real-machine smoke", body: "Requires local GPU" },
    { number: 94, title: "Improve cloud planner", body: "Bounded TypeScript work" },
    { number: 95, title: "PR-shaped issue", pull_request: { url: "x" } },
  ]));
  assert.deepEqual(candidates.map((candidate) => candidate.number), [94]);
});

test("planner uses an independent cloud-safe candidate while primary task is local-only", async () => {
  let seenParallel = false;
  const model: PlanningModel = {
    async plan(input) {
      seenParallel = input.context.some((item) => item.source === "parallel.cloud_candidates" && item.summary.includes("#94 Improve cloud planner"));
      return {
        kind: "propose_pr",
        description: "Implement bounded cloud planner improvement for Issue #94",
        title: "fix: improve bounded planner",
        body: "Closes #94",
        files: [{ path: "src/example.ts", content: "export const ok = true;\n" }],
      };
    },
  };
  const planner = new ModelBackedPlanner(model);
  const action = await planner.proposeNextAction({
    goal,
    context: context([
      { number: 78, title: "Run Qwen-Image-Edit real-machine smoke", body: "Requires local GPU" },
      { number: 94, title: "Improve cloud planner", body: "Bounded TypeScript work" },
    ]),
    intent: { summary: "advance safely", confidence: 0.9, evidence: [] },
  });

  assert.equal(seenParallel, true);
  assert.equal(action?.capability, "repository.propose_pr");
  assert.equal(action?.description, "Implement bounded cloud planner improvement for Issue #94");
});

test("planner stops once when no independent cloud-safe work exists", async () => {
  let modelCalled = false;
  const planner = new ModelBackedPlanner({
    async plan() {
      modelCalled = true;
      return { kind: "inspect", description: "should not run" };
    },
  });
  const action = await planner.proposeNextAction({
    goal,
    context: context([{ number: 78, title: "Run Qwen-Image-Edit real-machine smoke", body: "Requires local GPU" }]),
    intent: { summary: "advance safely", confidence: 0.9, evidence: [] },
  });

  assert.equal(modelCalled, false);
  assert.equal(action?.capability, "runtime.local_blocker");
});

test("cloud state adapter re-evaluates local blocker but preserves it in Compass", async () => {
  const compass = new CompassStore(":memory:");
  try {
    compass.updateState({ blockers: ["local_runtime_required", "security_review_required"], status: "blocked" });
    const adapter = new CloudCompassStateStoreAdapter(compass);
    const loopState = await adapter.getState();
    assert.deepEqual(loopState.blockers, ["security_review_required"]);
    assert.deepEqual(compass.getState().blockers, ["local_runtime_required", "security_review_required"]);
  } finally {
    compass.close();
  }
});
