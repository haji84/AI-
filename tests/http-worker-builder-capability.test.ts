import test from "node:test";
import assert from "node:assert/strict";
import { HttpWorkerBuilderCapability } from "../src/gai/http-worker-builder-capability.ts";

test("HTTP code builder verifies health capability and executes bounded build", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, capabilities: ["code-builder"] }), { status: 200 });
    }
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ ok: true, summary: "fixture changed", evidence: { commit: "abc" } }), { status: 200 });
  };
  const builder = new HttpWorkerBuilderCapability("zbook", { url: "https://worker.example", token: "secret" }, fetchImpl);
  assert.equal(await builder.available(), true);
  const result = await builder.build({ goalId: "g", attemptId: "a2", strategyId: "s2", objective: "change fixture", context: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["https://worker.example/health", "https://worker.example/build"]);
});


test("HTTP code builder preserves remote 502 failure evidence", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    ok: false,
    summary: "codex failed with exit -1",
    blocker: "CODING_ENGINE_FAILED",
    evidence: { exitCode: -1, stderrTail: "timed out" },
  }), { status: 502 });
  const builder = new HttpWorkerBuilderCapability("zbook", { url: "https://worker.example", token: "secret" }, fetchImpl);
  const result = await builder.build({ goalId: "g", attemptId: "a1", strategyId: "s1", objective: "change fixture", context: [] });
  assert.equal(result.ok, false);
  assert.equal(result.summary, "codex failed with exit -1");
  assert.equal(result.blocker, "CODING_ENGINE_FAILED");
  assert.deepEqual(result.evidence, {
    builderId: "zbook",
    strategyId: "s1",
    status: 502,
    remoteEvidence: { exitCode: -1, stderrTail: "timed out" },
  });
});
