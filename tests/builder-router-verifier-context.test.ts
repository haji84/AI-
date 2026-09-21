import test from "node:test";
import assert from "node:assert/strict";
import { BuilderRouter, type BuilderCapability, type BuilderRequest } from "../src/orchestrator/builder-router.ts";

test("BuilderRouter strips trusted verification oracle from Builder context", async () => {
  let observed: BuilderRequest | null = null;
  const builder: BuilderCapability = {
    id: "capture",
    async available() { return true; },
    async build(request) {
      observed = request;
      return { actionId: request.attemptId, ok: true, summary: "captured" };
    },
  };
  const router = new BuilderRouter([builder]);
  const result = await router.execute({
    id: "a",
    description: "build",
    capability: "code.builder",
    risk: "low",
    input: { goalId: "g", attemptId: "a1", strategyId: "s1", objective: "write runtime-wrong" },
  }, [
    { source: "normal", summary: "ordinary context", data: { visible: true } },
    {
      source: "unified-entry:1",
      summary: "trusted deterministic oracle",
      data: {
        source: "development.verification_contract",
        data: { kind: "file_exact", path: "tests/x.txt", expected: "runtime-daily" },
      },
    },
  ]);
  assert.equal(result.ok, true);
  assert.ok(observed);\n  const captured = observed as BuilderRequest;\n  assert.deepEqual(captured.context.map((item: { source: string }) => item.source), ["normal"]);
});
