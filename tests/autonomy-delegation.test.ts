import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomyDelegationCapability } from "../src/orchestrator/autonomy-delegation.ts";
import type { ProposedAction } from "../src/orchestrator/goal-loop.ts";

function action(input: unknown): ProposedAction {
  return {
    id: "delegate-1",
    description: "delegate work",
    capability: "autonomy.delegate",
    risk: "low",
    input,
  };
}

test("JARVIS delegation enqueues a device task and waits for verified completion", async () => {
  const calls: string[] = [];
  let stateReads = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/jarvis/admin/tasks") {
      return new Response(JSON.stringify({ task: { id: "task-1", status: "queued" } }), { status: 201 });
    }
    stateReads += 1;
    return new Response(JSON.stringify({
      tasks: [{ id: "task-1", status: stateReads >= 2 ? "completed" : "running", result: { ok: true } }],
      fleet: [],
    }), { status: 200 });
  };

  const capability = createAutonomyDelegationCapability({
    downstream: { async execute() { throw new Error("unused"); } },
    env: { JARVIS_BROKER_URL: "https://jarvis.example", JARVIS_OWNER_TOKEN: "owner" },
    fetchImpl,
    sleep: async () => {},
    jarvisTimeoutMs: 5_000,
  });

  const result = await capability.execute(action({
    target: "jarvis",
    operation: "open-app",
    payload: { packageName: "example.app" },
  }), []);

  assert.equal(result.ok, true);
  assert.equal(result.summary, "JARVIS completed open-app");
  assert.deepEqual(calls, [
    "POST /api/jarvis/admin/tasks",
    "GET /api/jarvis/admin/state",
    "GET /api/jarvis/admin/state",
  ]);
});

test("research delegation reports the exact missing executor instead of pretending completion", async () => {
  const capability = createAutonomyDelegationCapability({
    downstream: { async execute() { throw new Error("unused"); } },
    env: {},
  });
  const result = await capability.execute(action({ target: "research", researchKind: "local-safe" }), []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "RESEARCH_EXECUTOR_UNAVAILABLE");
  assert.match(result.summary, /no general research executor/i);
});
