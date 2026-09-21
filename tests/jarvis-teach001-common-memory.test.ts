import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TeachingStore,
  replayTeaching,
  type DeviceProfile,
  type Observation,
  type TeachingAdapter,
  type TeachingPlatform,
} from "../src/jarvis/teaching.ts";

const platforms: TeachingPlatform[] = ["android", "ios", "windows", "macos", "linux"];

function profileFor(platform: TeachingPlatform): DeviceProfile {
  return {
    deviceId: `teach001-${platform}`,
    platform,
    model: `model-${platform}`,
    osVersion: "1",
    app: "example.app",
    appVersion: "1",
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-teach001-"));
  const path = join(root, "teaching.json");
  return { root, path, store: new TeachingStore(path), clean: () => rmSync(root, { recursive: true, force: true }) };
}

function observation(profile: DeviceProfile): Observation {
  return { signature: "manual-screen", profile, targets: [], protectedScreen: false };
}

test("TEACH-001: all supported platforms persist through one common teaching store without inheriting verification", () => {
  const f = fixture();
  try {
    for (const platform of platforms) {
      const variant = f.store.manual({
        goal: "shared cross-device procedure",
        scope: "device",
        profile: profileFor(platform),
        instructions: "Open the target application\nNavigate to the work screen",
        completion: "The expected work screen is visible",
      });
      assert.equal(variant.status, "DRAFT");
      assert.equal(variant.profile.platform, platform);
      assert.equal(variant.verifiedRunId, undefined);
      assert(variant.steps.length > 0);
      assert(variant.steps.every((step) => step.gate && step.action.kind === "manual"));
    }

    const reloaded = new TeachingStore(f.path).list();
    assert.equal(reloaded.variants.length, platforms.length);
    assert.deepEqual(
      reloaded.variants.map((variant) => variant.profile.platform).sort(),
      [...platforms].sort(),
    );
    assert(reloaded.variants.every((variant) => variant.goal === "shared cross-device procedure"));
    assert(reloaded.variants.every((variant) => variant.status === "DRAFT" && variant.verifiedRunId === undefined));
    assert.equal(reloaded.runs.length, 0);
  } finally {
    f.clean();
  }
});

test("TEACH-001: manual cross-platform memory is fail-closed and cannot become automatic replay authority", async () => {
  const f = fixture();
  try {
    for (const platform of platforms) {
      const profile = profileFor(platform);
      const variant = f.store.manual({
        goal: "manual-only procedure",
        scope: "device",
        profile,
        instructions: "Open the application",
        completion: "Application is visible",
      });
      let executions = 0;
      const adapter: TeachingAdapter = {
        authorize() {},
        async observe() { return observation(profile); },
        async execute() { executions += 1; },
      };
      await assert.rejects(replayTeaching(f.store, variant.id, adapter, "verify"), /not ready|mismatch/i);
      await assert.rejects(replayTeaching(f.store, variant.id, adapter, "execute"), /not ready|mismatch/i);
      assert.equal(executions, 0);
    }
  } finally {
    f.clean();
  }
});

test("TEACH-001 security: credential-like manual content and corrupted evidence fail closed", () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.manual({
      goal: "unsafe procedure",
      scope: "device",
      profile: profileFor("windows"),
      instructions: "Enter password hunter2",
      completion: "Signed in",
    }), /credentials/i);
    assert.equal(f.store.list().variants.length, 0);

    writeFileSync(f.path, "{not-valid-json");
    assert.throws(() => new TeachingStore(f.path));
  } finally {
    f.clean();
  }
});
