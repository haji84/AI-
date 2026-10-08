import assert from "node:assert/strict";
import test from "node:test";
import {
  createDevelopmentState,
  nextDevelopmentState,
} from "../src/orchestrator/self-development-loop.ts";

test("legacy self-development stages expose the durable job state", () => {
  let state = createDevelopmentState({ jobId: "legacy-job", goalId: "goal-681", baseRevision: "c".repeat(40) });
  assert.equal(state.job.phase, "QUEUED");
  state = nextDevelopmentState(state, { stage: "INSPECT", ok: true, evidenceRefs: ["inspect:evidence"] });
  assert.equal(state.stage, "RESEARCH");
  assert.equal(state.job.phase, "PLANNING");
  state = nextDevelopmentState(state, { stage: "RESEARCH", ok: true, evidenceRefs: ["research:evidence"] });
  assert.equal(state.job.phase, "IMPLEMENTING");
  state = nextDevelopmentState(state, { stage: "IMPLEMENT", ok: true, evidenceRefs: ["implementation:evidence"] });
  assert.equal(state.job.phase, "VERIFYING");
});
test("progress-aware recovery does not abandon a goal after a fixed failure count", () => {
  let state = createDevelopmentState();
  state = nextDevelopmentState(state, { stage: "INSPECT", ok: true, evidenceRefs: ["inspect"] });
  state = nextDevelopmentState(state, { stage: "RESEARCH", ok: true, evidenceRefs: ["research"] });
  for (let index = 1; index <= 4; index += 1) {
    state = nextDevelopmentState(state, {
      stage: "IMPLEMENT",
      ok: false,
      evidenceRefs: [`failure:${index}`],
      reason: `failure ${index}`,
      failureSignature: `failure-${index}`,
      strategyId: `strategy-${index}`,
      hypothesis: `hypothesis-${index}`,
    });
    assert.equal(state.stage, "RECOVER");
    state = nextDevelopmentState(state, { stage: "RECOVER", ok: true, evidenceRefs: [`recovery:${index}`] });
    assert.equal(state.stage, "IMPLEMENT");
  }
  assert.equal(state.recoveryCount, 4);
  assert.equal(state.job.phase, "IMPLEMENTING");
});

test("materially equivalent failed strategy blocks until evidence or hypothesis changes", () => {
  let state = createDevelopmentState();
  state = nextDevelopmentState(state, { stage: "INSPECT", ok: true, evidenceRefs: ["inspect"] });
  state = nextDevelopmentState(state, { stage: "RESEARCH", ok: true, evidenceRefs: ["research"] });
  const failure = {
    stage: "IMPLEMENT" as const,
    ok: false,
    evidenceRefs: ["failure:same"],
    reason: "same failure",
    failureSignature: "same-signature",
    strategyId: "same-strategy",
    hypothesis: "same-hypothesis",
  };
  state = nextDevelopmentState(state, failure);
  state = nextDevelopmentState(state, { stage: "RECOVER", ok: true, evidenceRefs: ["recovery"] });
  state = nextDevelopmentState(state, failure);
  assert.equal(state.stage, "BLOCKED");
  assert.match(state.job.blockers[0] ?? "", /equivalent_failed_strategy/);
});

test("legacy state survives JSON reconstruction with durable failure history", () => {
  let state = createDevelopmentState();
  state = nextDevelopmentState(state, { stage: "INSPECT", ok: true, evidenceRefs: ["inspect"] });
  state = nextDevelopmentState(state, { stage: "RESEARCH", ok: true, evidenceRefs: ["research"] });
  state = nextDevelopmentState(state, {
    stage: "IMPLEMENT",
    ok: false,
    evidenceRefs: ["failure"],
    reason: "failed",
    failureSignature: "sig",
    strategyId: "strategy",
    hypothesis: "hypothesis",
  });
  const restored = structuredClone(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.job.failureSignatures, ["sig"]);
  const recovered = nextDevelopmentState(restored, { stage: "RECOVER", ok: true, evidenceRefs: ["fixed"] });
  assert.equal(recovered.stage, "IMPLEMENT");
  assert.deepEqual(recovered.job.failureSignatures, ["sig"]);
});
