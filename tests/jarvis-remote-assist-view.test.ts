import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOTE_ASSIST_FLEET_WINDOW,
  REMOTE_ASSIST_REFRESH_CONCURRENCY,
  remoteAssistAdaptiveRefreshMs,
  remoteAssistRefreshConcurrency,
  remoteAssistVisibleSerials,
  remoteAssistViewLimit,
  runRemoteAssistBounded,
} from "../src/jarvis/remote-assist-view.ts";

test("Remote Assist view modes have bounded device counts", () => {
  assert.equal(remoteAssistViewLimit("single"), 1);
  assert.equal(remoteAssistViewLimit("split2"), 2);
  assert.equal(remoteAssistViewLimit("split4"), 4);
  assert.equal(remoteAssistViewLimit("fleet"), REMOTE_ASSIST_FLEET_WINDOW);
  assert.equal(REMOTE_ASSIST_FLEET_WINDOW, 12);
  assert.equal(REMOTE_ASSIST_REFRESH_CONCURRENCY, 4);
});

test("split views keep valid explicit selections and fill without duplicates", () => {
  const available = ["a", "b", "c", "d", "e"];
  assert.deepEqual(remoteAssistVisibleSerials({
    mode: "split2",
    availableSerials: available,
    selectedSerials: ["d", "missing", "d"],
  }), ["d", "a"]);
  assert.deepEqual(remoteAssistVisibleSerials({
    mode: "split4",
    availableSerials: available,
    selectedSerials: ["c", "a"],
  }), ["c", "a", "b", "d"]);
});

test("fleet view pages at most 12 devices even for a 100-device list", () => {
  const available = Array.from({ length: 100 }, (_, index) => `android-${String(index + 1).padStart(3, "0")}`);
  const first = remoteAssistVisibleSerials({ mode: "fleet", availableSerials: available, fleetPage: 0 });
  const last = remoteAssistVisibleSerials({ mode: "fleet", availableSerials: available, fleetPage: 8 });
  assert.equal(first.length, 12);
  assert.equal(first[0], "android-001");
  assert.equal(first[11], "android-012");
  assert.equal(last.length, 4);
  assert.equal(last[0], "android-097");
  assert.equal(last[3], "android-100");
});

test("bounded runner never exceeds the requested concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const values = Array.from({ length: 20 }, (_, index) => index);
  const result = await runRemoteAssistBounded(values, REMOTE_ASSIST_REFRESH_CONCURRENCY, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum <= REMOTE_ASSIST_REFRESH_CONCURRENCY, true);
  assert.deepEqual(result, values.map((value) => value * 2));
});

test("adaptive refresh slows down under fleet load and failures while keeping concurrency bounded", () => {
  assert.equal(remoteAssistRefreshConcurrency(1), 1);
  assert.equal(remoteAssistRefreshConcurrency(4), 3);
  assert.equal(remoteAssistRefreshConcurrency(12), REMOTE_ASSIST_REFRESH_CONCURRENCY);
  const fast = remoteAssistAdaptiveRefreshMs("single", 1, 0);
  const fleet = remoteAssistAdaptiveRefreshMs("fleet", 12, 0);
  const degraded = remoteAssistAdaptiveRefreshMs("fleet", 12, 0.5);
  assert.ok(fast < fleet);
  assert.ok(fleet < degraded);
  assert.ok(degraded <= 8_000);
});
