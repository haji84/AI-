import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { applyCloudControl, ensureCloudGoal, GitHubRepositoryContextSource } from "../src/orchestrator/cloud-runtime.ts";

test("cloud runtime bootstraps a deterministic goal for ephemeral runners", () => {
  const compass = new CompassStore(":memory:");
  ensureCloudGoal(compass);
  const goal = compass.getGoal();
  assert.equal(goal?.title, "Advance the repository according to its explicit project state");
  ensureCloudGoal(compass);
  assert.equal(compass.getGoal()?.title, goal?.title);
  compass.close();
});

test("mobile pause and resume persist through Compass state", () => {
  const compass = new CompassStore(":memory:");
  applyCloudControl(compass, "pause");
  assert.equal(compass.getState().status, "PAUSED");
  applyCloudControl(compass, "resume");
  assert.equal(compass.getState().status, "READY");
  compass.close();
});

test("GitHub cloud context fails visibly rather than fabricating state", async () => {
  const source = new GitHubRepositoryContextSource({
    async readRepositoryState() { throw new Error("not connected"); },
  });
  const items = await source.collect();
  assert.equal(items[0]?.summary, "unavailable:not connected");
  assert.deepEqual(items[0]?.data, { available: false });
});
