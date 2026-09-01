import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { COMPASS_TOOL_NAMES, COMPASS_TOOLS, invokeCompassTool } from "../src/compass/tools.ts";

function withStore(run: (store: CompassStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "compass-tools-"));
  const store = new CompassStore(join(dir, "compass.db"));
  try {
    run(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Compass v1 exposes exactly nine named tools", () => {
  assert.equal(COMPASS_TOOLS.length, 9);
  assert.deepEqual(
    COMPASS_TOOLS.map((tool) => tool.name),
    [...COMPASS_TOOL_NAMES],
  );
  assert.deepEqual(COMPASS_TOOL_NAMES, [
    "get_goal",
    "set_goal",
    "get_state",
    "update_state",
    "get_next_action",
    "set_next_action",
    "record_verification",
    "write_back",
    "get_history",
  ]);
});

test("tool dispatcher supports goal, state, verification, history and next action", () => {
  withStore((store) => {
    assert.equal(invokeCompassTool(store, "get_goal", {}), null);

    const goal = invokeCompassTool(store, "set_goal", {
      title: "Compass v1",
      successCriteria: ["persistent"],
      constraints: ["local"],
    }) as { title: string };
    assert.equal(goal.title, "Compass v1");

    invokeCompassTool(store, "update_state", {
      phase: "implementation",
      completed: ["store"],
      nextAction: "transport",
    });
    assert.deepEqual(invokeCompassTool(store, "get_next_action", {}), { nextAction: "transport" });

    const verification = invokeCompassTool(store, "record_verification", {
      status: "PASS",
      summary: "unit tests",
    }) as { status: string };
    assert.equal(verification.status, "PASS");

    invokeCompassTool(store, "write_back", {
      status: "completed",
      summary: "tool contract complete",
      nextAction: null,
    });

    const history = invokeCompassTool(store, "get_history", { limit: 1 }) as { summary: string }[];
    assert.equal(history[0]?.summary, "tool contract complete");
    assert.deepEqual(invokeCompassTool(store, "get_next_action", {}), { nextAction: null });
  });
});

test("tool dispatcher rejects malformed calls", () => {
  withStore((store) => {
    assert.throws(() => invokeCompassTool(store, "unknown", {}), /unknown Compass tool/);
    assert.throws(() => invokeCompassTool(store, "set_goal", { title: "" }), /non-empty/);
    assert.throws(
      () => invokeCompassTool(store, "record_verification", { status: "MAYBE", summary: "bad" }),
      /PASS or FAIL/,
    );
    assert.throws(() => invokeCompassTool(store, "get_history", { limit: 1.5 }), /integer/);
    assert.throws(() => invokeCompassTool(store, "update_state", { completed: "not-array" }), /array/);
  });
});
