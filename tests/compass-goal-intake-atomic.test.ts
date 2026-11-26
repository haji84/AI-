import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalDecisionStoreAdapter, CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { GoalControllerRuntime, type UnifiedIntakeRequest } from "../src/orchestrator/goal-controller-runtime.ts";

function controller(store: CompassStore): GoalControllerRuntime {
  return new GoalControllerRuntime({
    registry: new CompassGoalRegistryAdapter(store),
    decisionStore: new CompassGoalDecisionStoreAdapter(store),
  });
}

function request(text: string, idempotencyKey: string): UnifiedIntakeRequest {
  return {
    source: "github",
    text,
    idempotencyKey,
    goalContract: { successCriteria: [`${text} verified`], constraints: ["preserve approval gates"] },
  };
}

for (const keyMode of ["distinct", "same"] as const) {
  test(`concurrent distinct Goals with ${keyMode} idempotency keys cannot both be accepted`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "compass-intake-atomic-"));
    const path = join(directory, "compass.db");
    const first = new CompassStore(path), second = new CompassStore(path);
    try {
      const inputs = [
        request("Complete alpha implementation", "intake-alpha"),
        request("Complete beta implementation", keyMode === "same" ? "intake-alpha" : "intake-beta"),
      ];
      const outcomes = await Promise.allSettled([
        controller(first).handle(inputs[0]!),
        controller(second).handle(inputs[1]!),
      ]);
      const accepted = outcomes.filter(outcome => outcome.status === "fulfilled");
      const rejected = outcomes.filter(outcome => outcome.status === "rejected");
      assert.equal(accepted.length, 1, "Only the Goal committed by the authority may be acknowledged");
      assert.equal(rejected.length, 1);
      assert.match(String(rejected[0]!.reason), /active Compass Goal already exists/);
      const winner = accepted[0]!.value;
      assert.equal(winner.action, "CONTINUE_GOAL");
      assert.equal(winner.resolution.goal?.goal.title, first.getGoal()?.title);
      assert.deepEqual(first.getGoal(), second.getGoal());
      if (keyMode === "distinct") {
        const rejectedInput = inputs[outcomes.findIndex(outcome => outcome.status === "rejected")]!;
        assert.equal(await new CompassGoalDecisionStoreAdapter(first).get(rejectedInput.idempotencyKey!), null);
      }
    } finally {
      first.close();
      second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const keyMode of ["same", "distinct"] as const) {
  test(`concurrent identical Goal contracts with ${keyMode} keys converge and replay after restart`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "compass-intake-replay-"));
    const path = join(directory, "compass.db");
    const first = new CompassStore(path), second = new CompassStore(path);
    let acceptedGoalId: string | undefined;
    let persisted: ReturnType<CompassStore["getGoal"]>;
    const inputs = [
      request("Complete a bounded report", "report-first"),
      request("Complete a bounded report", keyMode === "same" ? "report-first" : "report-second"),
    ];
    try {
      const outcomes = await Promise.all([
        controller(first).handle(inputs[0]!),
        controller(second).handle(inputs[1]!),
      ]);
      assert.equal(outcomes[0]!.goalId, outcomes[1]!.goalId);
      acceptedGoalId = outcomes[0]!.goalId;
      assert.ok(acceptedGoalId);
      persisted = first.getGoal();
      assert.equal(persisted?.title, "Complete a bounded report");
      assert.deepEqual(persisted?.successCriteria, ["Complete a bounded report verified"]);
      assert.deepEqual(persisted?.constraints, ["preserve approval gates"]);
    } finally {
      first.close();
      second.close();
    }
    const reopened = new CompassStore(path);
    try {
      for (const input of inputs) {
        const replay = await controller(reopened).handle({ ...input, source: "jarvis" });
        assert.equal(replay.goalId, acceptedGoalId);
      }
      assert.deepEqual(reopened.getGoal(), persisted, "Replay must not rewrite the accepted Goal");
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("Goal intake cannot overwrite a different Goal committed while waiting for a SQLite writer", { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "compass-intake-writer-"));
  const path = join(directory, "compass.db");
  const store = new CompassStore(path);
  const storeUrl = new URL("../src/compass/store.ts", import.meta.url).href;
  const peer = spawn(process.execPath, ["--input-type=module", "-e", `
    import { CompassStore } from ${JSON.stringify(storeUrl)};
    const store = new CompassStore(process.argv[1]);
    try {
      store.updateActive(active => {
        process.stdout.write("LOCKED\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        store.setGoal({ title: "Peer accepted Goal", description: "Already owned",
          successCriteria: ["Peer criterion"], constraints: ["Peer constraint"] });
        return active;
      });
    } finally { store.close(); }
  `, path], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(peer, "exit");
  let stderr = "";
  peer.stderr!.on("data", chunk => { stderr += String(chunk); });
  try {
    const [signal] = await once(peer.stdout!, "data");
    assert.match(String(signal), /LOCKED/);
    await assert.rejects(new CompassGoalRegistryAdapter(store).create({
      title: "Late competing Goal", description: "Must not replace the accepted peer",
      successCriteria: ["Different criterion"], constraints: [],
    }), /active Compass Goal already exists/);
    const [code] = await exited;
    assert.equal(code, 0, stderr);
    assert.equal(store.getGoal()?.title, "Peer accepted Goal");
    assert.deepEqual(store.getGoal()?.successCriteria, ["Peer criterion"]);
    assert.deepEqual(store.getGoal()?.constraints, ["Peer constraint"]);
  } finally {
    peer.kill();
    await exited;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const replayChanges: Array<{ name: string; change: Partial<UnifiedIntakeRequest> }> = [
  { name: "text", change: { text: "Complete a different report" } },
  { name: "success criteria", change: { goalContract: { successCriteria: ["Different verified result"], constraints: ["preserve approval gates"] } } },
  { name: "constraints", change: { goalContract: { successCriteria: ["Complete a bounded report verified"], constraints: ["new execution scope"] } } },
  { name: "target Goal", change: { goalHint: "foreign-goal" } },
];

for (const cache of ["memory", "persisted"] as const) {
  for (const { name, change } of replayChanges) {
    test(`${cache} idempotency replay rejects changed ${name} without changing the accepted request`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "compass-intake-conflict-"));
      const path = join(directory, "compass.db");
      let store = new CompassStore(path);
      try {
        let runtime = controller(store);
        const input = request("Complete a bounded report", "immutable-request");
        const accepted = await runtime.handle(input);
        const goal = store.getGoal();
        if (cache === "persisted") {
          store.close();
          store = new CompassStore(path);
          runtime = controller(store);
        }
        await assert.rejects(runtime.handle({ ...input, ...change }), /INTAKE_IDEMPOTENCY_CONFLICT/);
        assert.deepEqual(store.getGoal(), goal);
        const replay = await runtime.handle({ ...input, source: "jarvis", goalHint: accepted.goalId });
        assert.equal(replay.goalId, accepted.goalId);
        assert.equal(replay.resolution.intake.text, "Complete a bounded report");
        assert.deepEqual(replay.resolution.intake.goalContract, input.goalContract);
      } finally {
        store.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test("concurrent different requests cannot overwrite a shared idempotency key for an existing Goal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "compass-intake-decision-race-"));
  const path = join(directory, "compass.db");
  const first = new CompassStore(path), second = new CompassStore(path);
  try {
    const acceptedGoal = await controller(first).handle(request("Complete the existing Goal", "initial-goal"));
    const goal = first.getGoal();
    const runtimes = [controller(first), controller(second)];
    const inputs: UnifiedIntakeRequest[] = [
      { source: "github", text: "Implement the alpha report", idempotencyKey: "shared-request", goalHint: acceptedGoal.goalId },
      { source: "github", text: "Implement the beta report", idempotencyKey: "shared-request", goalHint: acceptedGoal.goalId },
    ];
    const outcomes = await Promise.allSettled(runtimes.map((runtime, index) => runtime.handle(inputs[index]!)));
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    const acceptedIndex = outcomes.findIndex(outcome => outcome.status === "fulfilled");
    const rejectedIndex = outcomes.findIndex(outcome => outcome.status === "rejected");
    const rejected = outcomes[rejectedIndex]!;
    assert.equal(rejected.status, "rejected");
    assert.match(String(rejected.reason), /INTAKE_IDEMPOTENCY_CONFLICT/);
    assert.deepEqual(first.getGoal(), goal);
    const durable = await new CompassGoalDecisionStoreAdapter(second).get("shared-request");
    assert.equal(durable?.resolution.intake.text, inputs[acceptedIndex]!.text);
    const replay = await runtimes[rejectedIndex]!.handle(inputs[acceptedIndex]!);
    assert.equal(replay.resolution.intake.text, inputs[acceptedIndex]!.text,
      "A rejected write must not leave an uncommitted decision in the runtime cache");
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a losing Goal intake cannot leave a Goal behind when a question owns its idempotency key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "compass-intake-answer-race-"));
  const path = join(directory, "compass.db");
  const first = new CompassStore(path), second = new CompassStore(path);
  const question: UnifiedIntakeRequest = {
    source: "github", text: "What is the current report?", idempotencyKey: "question-or-goal",
  };
  const goalRequest = request("Complete alpha implementation", "question-or-goal");
  try {
    const [answer, rejectedGoal] = await Promise.allSettled([
      controller(first).handle(question),
      controller(second).handle(goalRequest),
    ]);
    assert.equal(answer.status, "fulfilled");
    assert.equal(answer.value.action, "ANSWER");
    assert.equal(rejectedGoal.status, "rejected");
    assert.match(String(rejectedGoal.reason), /INTAKE_IDEMPOTENCY_CONFLICT/);
    assert.equal(first.getGoal(), null, "The rejected intake must roll back its Goal creation");
    assert.equal(second.getGoal(), null);
  } finally {
    first.close();
    second.close();
  }
  const reopened = new CompassStore(path);
  try {
    assert.equal((await controller(reopened).handle(question)).action, "ANSWER");
    await assert.rejects(controller(reopened).handle(goalRequest), /INTAKE_IDEMPOTENCY_CONFLICT/);
    assert.equal(reopened.getGoal(), null);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const resolution of ["similarity", "hint"] as const) {
  for (const field of ["successCriteria", "constraints"] as const) {
    test(`a fresh ${resolution} intake rejects changed ${field} on the accepted Goal`, async () => {
      const store = new CompassStore(":memory:");
      try {
        const initial = request("Complete the bounded report", "accepted-contract");
        const accepted = await controller(store).handle(initial);
        const goal = store.getGoal();
        const changed: UnifiedIntakeRequest = {
          ...initial,
          text: resolution === "hint" ? "Complete a new explicitly targeted request" : initial.text,
          idempotencyKey: "changed-contract",
          goalHint: resolution === "hint" ? accepted.goalId : undefined,
          goalContract: { ...initial.goalContract!, [field]: ["different obligation"] },
        };
        await assert.rejects(controller(store).handle(changed), /GOAL_CONTRACT_CONFLICT/);
        assert.deepEqual(store.getGoal(), goal);
        assert.equal(await new CompassGoalDecisionStoreAdapter(store).get("changed-contract"), null,
          "An unaccepted contract must not acquire a durable success decision");
        const unchanged = await controller(store).handle({ ...initial, idempotencyKey: "same-contract" });
        assert.equal(unchanged.goalId, accepted.goalId);
      } finally { store.close(); }
    });
  }
}
