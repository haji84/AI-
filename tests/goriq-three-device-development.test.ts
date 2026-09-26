import assert from "node:assert/strict";
import test from "node:test";
import { initialWorkerProfiles, iphoneWorkerProfile, macbookWorkerProfile, zbookWorkerProfile } from "../src/gai/initial-worker-profiles.ts";

test("one iPhone plus ZBook and MacBook form the development topology", () => {
  assert.deepEqual(initialWorkerProfiles.map((profile) => profile.id), ["zbook", "macbook", "iphone"]);
  assert.equal(initialWorkerProfiles.filter((profile) => profile.platform === "ios").length, 1);
  assert.ok(zbookWorkerProfile.capabilities.includes("code-builder"));
  assert.ok(macbookWorkerProfile.capabilities.includes("code-builder"));
  assert.equal(iphoneWorkerProfile.capabilities.includes("code-builder"), false);
  assert.equal(iphoneWorkerProfile.executionModes?.includes("resident"), false);
  assert.ok(iphoneWorkerProfile.capabilities.includes("offline-cache"));
  assert.ok(iphoneWorkerProfile.capabilities.includes("background-task"));
});

