import assert from "node:assert/strict";
import test from "node:test";
import { LiveGitHubReadClient, normalizeGitHubCollection, type GitHubTransport } from "../src/orchestrator/github-live-client.ts";

test("normalizes direct arrays without recovery", () => {
  const result = normalizeGitHubCollection([{ number: 98 }]);
  assert.deepEqual(result.items, [{ number: 98 }]);
  assert.deepEqual(result.diagnostic, { count: 1, sourceShape: "array", recovered: false });
});

test("recovers connector-like and stringified collection payloads", () => {
  const wrapped = normalizeGitHubCollection({ structuredContent: { content: JSON.stringify([{ number: 98 }]) } });
  assert.deepEqual(wrapped.items, [{ number: 98 }]);
  assert.equal(wrapped.diagnostic.count, 1);
  assert.equal(wrapped.diagnostic.recovered, true);

  const runs = normalizeGitHubCollection({ workflow_runs: [{ id: 123 }] });
  assert.deepEqual(runs.items, [{ id: 123 }]);
});

test("unrecognized payloads fail safe and expose diagnostics", () => {
  const result = normalizeGitHubCollection({ unexpected: true });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.diagnostic, { count: 0, sourceShape: "object", recovered: false });
});

test("live client exposes normalized arrays and collection diagnostics", async () => {
  const responses: Record<string, unknown> = {
    "/repos/haji84/AI-": { default_branch: "main" },
    "/repos/haji84/AI-/issues?state=open&per_page=20": { content: JSON.stringify([{ number: 98, title: "safe task" }]) },
    "/repos/haji84/AI-/pulls?state=open&per_page=20": [],
    "/repos/haji84/AI-/actions/runs?per_page=10": { workflow_runs: [{ id: 456 }] },
  };
  const transport: GitHubTransport = {
    async get(path) {
      return responses[path];
    },
  };
  const client = new LiveGitHubReadClient({ token: "token", repository: "haji84/AI-", apiBaseUrl: "https://api.github.com" }, transport);
  const state = await client.readRepositoryState() as {
    openIssues: unknown[];
    openPullRequests: unknown[];
    recentWorkflowRuns: unknown[];
    collectionDiagnostics: Record<string, { count: number; recovered: boolean }>;
  };

  assert.deepEqual(state.openIssues, [{ number: 98, title: "safe task" }]);
  assert.deepEqual(state.openPullRequests, []);
  assert.deepEqual(state.recentWorkflowRuns, [{ id: 456 }]);
  assert.equal(state.collectionDiagnostics.openIssues?.count, 1);
  assert.equal(state.collectionDiagnostics.openIssues?.recovered, true);
});
