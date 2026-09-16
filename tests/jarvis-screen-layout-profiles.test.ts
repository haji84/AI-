import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import {
  DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES,
  JARVIS_PRIMARY_SCREENS,
  JARVIS_SCREEN_LAYOUT_OPTIONS,
  jarvisScreenIdFromPathname,
  normalizeJarvisScreenLayoutProfiles,
} from "../src/app/jarvis/screen-layout-profiles.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("screen layout profiles cover each primary screen with bounded options", () => {
  assert.equal(JARVIS_PRIMARY_SCREENS.length, 5);
  assert.deepEqual(Object.keys(DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES).sort(), JARVIS_PRIMARY_SCREENS.map(([id]) => id).sort());
  assert.deepEqual(JARVIS_SCREEN_LAYOUT_OPTIONS.map(([id]) => id), ["inherit", "command", "balanced", "focus", "mobile"]);
});

test("malformed screen layout profile state normalizes fail-safe to inherit", () => {
  assert.deepEqual(normalizeJarvisScreenLayoutProfiles({ home: "focus", devices: "giant", tasks: 2 }), {
    home: "focus",
    devices: "inherit",
    tasks: "inherit",
    research: "inherit",
    settings: "inherit",
  });
  assert.deepEqual(normalizeJarvisScreenLayoutProfiles(null), DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES);
});

test("pathname mapping is bounded to the five primary JARVIS screens", () => {
  assert.equal(jarvisScreenIdFromPathname("/jarvis"), "home");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/devices/abc"), "devices");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/tasks"), "tasks");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/research"), "research");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/settings"), "settings");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/enroll"), null);
  assert.equal(jarvisScreenIdFromPathname("/jarvis/login"), null);
});

test("per-screen layout UI stays browser-local and shell reapplies it on route changes", async () => {
  const model = await source("src/app/jarvis/screen-layout-profiles.ts");
  const settings = await source("src/app/jarvis/settings/JarvisScreenLayoutProfiles.tsx");
  const shell = await source("src/app/jarvis/JarvisPrimaryShell.tsx");
  const layout = await source("src/app/jarvis/layout.tsx");

  assert.match(model, /localStorage\.getItem\(JARVIS_SCREEN_LAYOUT_PROFILE_KEY\)/);
  assert.match(model, /localStorage\.setItem\(JARVIS_SCREEN_LAYOUT_PROFILE_KEY/);
  assert.match(model, /delete root\.dataset\.jarvisScreenLayout/);
  assert.match(settings, /JARVIS_PRIMARY_SCREENS\.map/);
  assert.match(settings, /端末操作・認証・Human Gateには触れない/);
  assert.doesNotMatch(settings, /fetch\(/);
  assert.doesNotMatch(settings, /\/api\//);
  assert.match(shell, /applyJarvisScreenLayoutProfile\(pathname/);
  assert.match(shell, /\[pathname\]/);
  assert.match(shell, /jarvis-screen-layout-profiles-changed/);
  assert.match(layout, /import "\.\/screen-layout-profiles\.css"/);
});
