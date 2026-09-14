import assert from "node:assert/strict";
import test from "node:test";

import {
  createHttpResearchWorkerRunner,
  parseResearchWorkerEndpoints,
} from "../src/gai/research-executor.ts";

const request = {
  id: "research:worker",
  query: "analyze this evidence",
  kind: "local-model" as const,
  route: {
    requestId: "research:worker",
    action: "run-worker" as const,
    workerId: "zbook",
    reason: "selected healthy worker zbook",
  },
  context: [{ source: "test", summary: "bounded evidence" }],
};

test("worker endpoint config accepts only HTTPS endpoints with non-empty tokens", () => {
  const endpoints = parseResearchWorkerEndpoints(JSON.stringify({
    zbook: { url: "https://zbook.example/", token: "secret" },
    insecure: { url: "http://plain.example", token: "secret" },
    empty: { url: "https://empty.example", token: "" },
  }));
  assert.deepEqual(endpoints, {
    zbook: { url: "https://zbook.example", token: "secret" },
  });
});

test("HTTP research worker receives bounded query and returns verified result", async () => {
  const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const runner = createHttpResearchWorkerRunner({
    endpoints: { zbook: { url: "https://zbook.example", token: "worker-secret" } },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        ok: true,
        summary: "local research complete",
        evidence: { model: "local" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await runner.execute(request, "zbook");
  assert.equal(result.ok, true);
  assert.equal(result.summary, "local research complete");
  assert.equal(calls[0]?.url, "https://zbook.example/research");
  assert.equal(calls[0]?.auth, "Bearer worker-secret");
  const body = calls[0]?.body as { query: string; kind: string; context: unknown[] };
  assert.equal(body.query, request.query);
  assert.equal(body.kind, "local-model");
  assert.equal(body.context.length, 1);
});

test("cross-device research executes every selected worker and combines evidence", async () => {
  const seen: string[] = [];
  const runner = createHttpResearchWorkerRunner({
    endpoints: {
      zbook: { url: "https://zbook.example", token: "a" },
      macbook: { url: "https://macbook.example", token: "b" },
    },
    fetchImpl: async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ ok: true, summary: `done:${String(url)}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await runner.execute({ ...request, kind: "cross-device" }, "zbook,macbook");
  assert.equal(result.ok, true);
  assert.match(result.summary, /Cross-device research completed/);
  assert.deepEqual(seen, ["https://zbook.example/research", "https://macbook.example/research"]);
});

test("missing endpoint is an exact blocker instead of a fake success", async () => {
  const runner = createHttpResearchWorkerRunner({ endpoints: {} });
  const result = await runner.execute(request, "zbook");
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "RESEARCH_WORKER_ENDPOINT_UNAVAILABLE");
});
