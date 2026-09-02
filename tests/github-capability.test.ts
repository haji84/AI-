import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { createGitHubReadCapability } from "../src/orchestrator/github-capability.ts";

test("GitHub read capability executes through injected client", async () => {
  let calls = 0;
  const registry = new CapabilityRegistry().registerManaged(createGitHubReadCapability({
    async readRepositoryState() {
      calls += 1;
      return { branch: "main", openIssues: 2 };
    },
  }));

  const result = await registry.execute({
    id: "gh-1",
    description: "read repository state",
    capability: "github.read_repository_state",
    risk: "low",
  }, []);

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(result.evidence, { state: { branch: "main", openIssues: 2 } });
});

test("GitHub read capability fails safely when connector is unavailable", async () => {
  const registry = new CapabilityRegistry().registerManaged(createGitHubReadCapability({
    async readRepositoryState() {
      throw new Error("not connected");
    },
  }));

  const result = await registry.execute({
    id: "gh-2",
    description: "read repository state",
    capability: "github.read_repository_state",
    risk: "low",
  }, []);

  assert.equal(result.ok, false);
  assert.equal(result.blocker, "github_read_unavailable");
});
