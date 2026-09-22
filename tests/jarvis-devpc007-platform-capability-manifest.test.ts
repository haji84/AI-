import assert from "node:assert/strict";
import test from "node:test";

import { androidWorkerProfile } from "../src/gai/android-worker-adapter.ts";
import { CommonWorkerRuntime } from "../src/gai/common-worker-runtime.ts";
import {
  PLATFORM_CAPABILITY_MANIFESTS,
  buildWorkerPlatformCapabilityManifest,
  validateWorkerDescriptorAgainstPlatformManifest,
} from "../src/gai/platform-capability-manifest.ts";
import {
  iphoneWorkerProfile,
  macbookWorkerProfile,
  zbookWorkerProfile,
} from "../src/gai/initial-worker-profiles.ts";
import type { WorkerDescriptor } from "../src/gai/worker-runtime.ts";

const baseDescriptor = (overrides: Partial<WorkerDescriptor> = {}): WorkerDescriptor => ({
  id: "test-worker",
  label: "Test Worker",
  platform: "linux",
  deviceType: "server",
  capabilities: ["browser", "filesystem"],
  executionModes: ["resident"],
  networkRequirement: "offline-capable",
  maxParallelTasks: 1,
  enabled: true,
  ...overrides,
});

test("DEV-PC-007 defines explicit manifests for every worker platform", () => {
  assert.deepEqual(Object.keys(PLATFORM_CAPABILITY_MANIFESTS).sort(), [
    "android",
    "ios",
    "linux",
    "macos",
    "windows",
  ]);

  assert.equal(PLATFORM_CAPABILITY_MANIFESTS.windows.toolingCapability, "windows-tooling");
  assert.equal(PLATFORM_CAPABILITY_MANIFESTS.macos.toolingCapability, "macos-tooling");
  assert.equal(PLATFORM_CAPABILITY_MANIFESTS.ios.toolingCapability, "ios-tooling");
  assert.equal(PLATFORM_CAPABILITY_MANIFESTS.android.toolingCapability, "android-tooling");
  assert.equal(PLATFORM_CAPABILITY_MANIFESTS.linux.toolingCapability, null);
});

test("DEV-PC-007 produces deterministic bounded manifests for current platform profiles", () => {
  for (const profile of [zbookWorkerProfile, macbookWorkerProfile, iphoneWorkerProfile, androidWorkerProfile]) {
    const manifest = buildWorkerPlatformCapabilityManifest(profile);
    assert.equal(manifest.workerId, profile.id);
    assert.equal(manifest.platform, profile.platform);
    assert.deepEqual(manifest.capabilities, [...profile.capabilities].sort());
    assert.deepEqual(manifest.executionModes, [...(profile.executionModes ?? [])].sort());
    assert.equal(manifest.networkRequirement, profile.networkRequirement ?? null);
  }
});

test("DEV-PC-007 rejects cross-platform tooling claims fail-closed", () => {
  const invalid = baseDescriptor({
    platform: "windows",
    capabilities: ["browser", "ios-tooling"],
  });

  assert.deepEqual(validateWorkerDescriptorAgainstPlatformManifest(invalid), [
    "capability ios-tooling belongs to ios, not windows",
  ]);
  assert.throws(
    () => new CommonWorkerRuntime({ descriptor: invalid }),
    /Invalid platform capability manifest.*ios-tooling belongs to ios, not windows/,
  );
});

test("DEV-PC-007 rejects duplicate and unknown capability declarations before execution", () => {
  const invalid = baseDescriptor({
    capabilities: ["browser", "browser", "not-a-real-capability" as never],
  });

  assert.deepEqual(validateWorkerDescriptorAgainstPlatformManifest(invalid), [
    "duplicate capability browser",
    "unknown capability not-a-real-capability",
  ]);
  assert.throws(
    () => new CommonWorkerRuntime({ descriptor: invalid }),
    /duplicate capability browser.*unknown capability not-a-real-capability/,
  );
});

test("DEV-PC-007 keeps shared capabilities portable and forbids platform tooling on Linux", () => {
  const portable = baseDescriptor({
    platform: "linux",
    capabilities: ["browser", "filesystem", "gpu", "local-model", "offline-cache"],
  });
  assert.deepEqual(validateWorkerDescriptorAgainstPlatformManifest(portable), []);

  const wrongTooling = baseDescriptor({
    platform: "linux",
    capabilities: ["browser", "android-tooling"],
  });
  assert.deepEqual(validateWorkerDescriptorAgainstPlatformManifest(wrongTooling), [
    "capability android-tooling belongs to android, not linux",
  ]);
});

test("DEV-PC-007 rejects duplicate execution modes to keep manifests unambiguous", () => {
  const invalid = baseDescriptor({ executionModes: ["resident", "resident"] });
  assert.deepEqual(validateWorkerDescriptorAgainstPlatformManifest(invalid), [
    "duplicate execution mode resident",
  ]);
});
