import test from "node:test";
import assert from "node:assert/strict";
import { createCognitiveProxy } from "../src/orchestrator/cognitive-proxy.ts";
test("cognitive ingress requires owner, prevents target/scope injection and streams a bounded body", async () => {
  let calls = 0, cancelled = false;
  const broker = async (_p: string, init?: RequestInit) => { calls++; assert.ok(init?.signal); return Response.json({ mode: "LOCAL" }); };
  const denied = createCognitiveProxy(async () => false, broker);
  assert.equal((await denied.GET()).status, 401);
  assert.equal((await denied.POST(new Request("http://localhost", { method: "POST", body: "{}" }))).status, 401);
  assert.equal(calls, 0);
  const proxy = createCognitiveProxy(async () => true, broker);
  for (const payload of [{ goalId: "goal-0000000000000000", dataRoot: "/" }, { goalId: "wrong" }, { goalId: "goal-0000000000000000", allowExternalAI: true }]) {
    assert.equal((await proxy.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(payload) }))).status, 400);
  }
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(513)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
  assert.equal((await proxy.POST(request)).status, 400); assert.equal(cancelled, true); assert.equal(calls, 0);
  assert.equal((await proxy.POST(new Request("http://localhost", { method: "POST", body: '{"goalId":"goal-0000000000000000"}' }))).status, 200);
  assert.equal(calls, 1);
});
