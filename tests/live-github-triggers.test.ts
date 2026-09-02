import assert from "node:assert/strict";
import test from "node:test";
import { LiveGitHubReadClient, githubRuntimeConfig, type GitHubTransport } from "../src/orchestrator/github-live-client.ts";
import { repositoryTrigger, scheduledTrigger, triggerToAutonomyEvent } from "../src/orchestrator/trigger-runtime.ts";

test("missing GitHub authorization returns structured not_connected state", async () => {
  const config = githubRuntimeConfig({ GITHUB_REPOSITORY: "owner/repo" });
  const client = new LiveGitHubReadClient(config, { async get() { throw new Error("must not be called"); } });
  assert.deepEqual(await client.readRepositoryState(), {
    available: false,
    reason: "not_connected",
    repository: "owner/repo",
  });
});

test("live GitHub client reads bounded repository state with injected transport", async () => {
  const paths: string[] = [];
  const transport: GitHubTransport = {
    async get(path) {
      paths.push(path);
      return { path };
    },
  };
  const client = new LiveGitHubReadClient({
    token: "runtime-only-token",
    repository: "owner/repo",
    apiBaseUrl: "https://api.github.com",
  }, transport);
  const state = await client.readRepositoryState() as { available: boolean; repository: string };
  assert.equal(state.available, true);
  assert.equal(state.repository, "owner/repo");
  assert.deepEqual(paths, [
    "/repos/owner/repo",
    "/repos/owner/repo/issues?state=open&per_page=20",
    "/repos/owner/repo/pulls?state=open&per_page=20",
    "/repos/owner/repo/actions/runs?per_page=10",
  ]);
});

test("scheduled trigger becomes a schedule autonomy event", () => {
  const trigger = scheduledTrigger("nightly check");
  const event = triggerToAutonomyEvent(trigger);
  assert.equal(event.type, "schedule");
  assert.equal(event.summary, "nightly check");
});

test("repository trigger preserves event kind", () => {
  const trigger = repositoryTrigger({ id: "pr-9", summary: "PR changed", kind: "pull_request", data: { number: 9 } });
  const event = triggerToAutonomyEvent(trigger);
  assert.equal(event.type, "repository_state");
  assert.equal(event.id, "pr-9");
  assert.deepEqual((event.data as { payload: unknown }).payload, {
    kind: "pull_request",
    payload: { number: 9 },
  });
});
