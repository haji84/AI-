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
