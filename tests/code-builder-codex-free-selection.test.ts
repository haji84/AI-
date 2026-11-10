import assert from "node:assert/strict";
import test from "node:test";
import { createCodeBuilderWorkerServer } from "../scripts/code-builder-worker-service.ts";

async function healthFor(models: unknown[], overrides: Record<string, string> = {}, endpoint = "http://127.0.0.1:11434") {
  let queried = 0;
  const server = createCodeBuilderWorkerServer({
    env: {
      NODE_ENV: "test",
      CODE_BUILDER_TOKEN: "test-only-local-code-builder",
      CODE_BUILDER_WORKSPACE: process.cwd(),
      GORIQ_OLLAMA_URL: endpoint,
      ...overrides,
    },
    repairFetchImpl: async (input) => {
      queried++;
      assert.equal(String(input), "http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({ models }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { Authorization: "Bearer test-only-local-code-builder" },
    });
    assert.equal(response.status, 200);
    return { body: await response.json() as {
      engine: string | null;
      capabilities: string[];
      inference: { locality: string; networkAccess: boolean };
    }, queried };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Codex CLI setting cannot preempt an installed local Ollama model", async () => {
  const { body, queried } = await healthFor([{ name: "qwen2.5-coder:3b" }], {
    CODE_BUILDER_ENGINE: "codex",
  });
  assert.equal(queried, 1);
  assert.equal(body.engine, "goriq-ollama-repair");
  assert.ok(body.capabilities.includes("code-builder"));
  assert.deepEqual(body.inference, { locality: "device", networkAccess: false });
});

test("no installed model leaves the Builder unavailable instead of invoking Codex", async () => {
  const { body, queried } = await healthFor([], { CODE_BUILDER_ENGINE: "codex" });
  assert.equal(queried, 1);
  assert.equal(body.engine, null);
  assert.deepEqual(body.capabilities, ["filesystem"]);
});

test("a remote Ollama URL is never probed or claimed as device-local", async () => {
  const { body, queried } = await healthFor([{ name: "qwen2.5-coder:3b" }],
    {}, "https://external.invalid");
  assert.equal(queried, 0);
  assert.equal(body.engine, null);
  assert.deepEqual(body.capabilities, ["filesystem"]);
});

test("remote-referenced model tags cannot grant local coding capability", async () => {
  const { body } = await healthFor([{ name: "qwen2.5-coder:3b", remote_host: "other-host" }]);
  assert.equal(body.engine, null);
  assert.deepEqual(body.capabilities, ["filesystem"]);
});
