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

test("screen layout profiles cover all configurable GORIQ screens with bounded options", () => {
  assert.equal(JARVIS_PRIMARY_SCREENS.length, 7);
  assert.deepEqual(Object.keys(DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES).sort(), JARVIS_PRIMARY_SCREENS.map(([id]) => id).sort());
  assert.deepEqual(JARVIS_SCREEN_LAYOUT_OPTIONS.map(([id]) => id), ["inherit", "command", "balanced", "focus", "mobile"]);
});

test("malformed screen layout profile state normalizes fail-safe to inherit", () => {
  assert.deepEqual(normalizeJarvisScreenLayoutProfiles({ home: "focus", devices: "giant", tasks: 2 }), {
    home: "focus",
    tasks: "inherit",
    newDevelopment: "inherit",
    decisions: "inherit",
    devices: "inherit",
    research: "inherit",
    settings: "inherit",
  });
  assert.deepEqual(normalizeJarvisScreenLayoutProfiles(null), DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES);
});

test("pathname mapping includes the new development and decision surfaces", () => {
  assert.equal(jarvisScreenIdFromPathname("/jarvis"), "home");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/tasks"), "tasks");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/new-development"), "newDevelopment");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/decisions"), "decisions");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/devices/abc"), "devices");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/research"), "research");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/settings"), "settings");
  assert.equal(jarvisScreenIdFromPathname("/jarvis/enroll"), null);
  assert.equal(jarvisScreenIdFromPathname("/jarvis/login"), null);
});

test("per-design per-screen layout UI stays browser-local and shell reapplies it on route/design changes", async () => {
  const model = await source("src/app/jarvis/screen-layout-profiles.ts");
  const settings = await source("src/app/jarvis/settings/JarvisScreenLayoutProfiles.tsx");
  const shell = await source("src/app/jarvis/JarvisPrimaryShell.tsx");
  const layout = await source("src/app/jarvis/layout.tsx");

  assert.match(model, /jarvis-screen-layout-profiles-v2/);
  assert.match(model, /jarvis-screen-layout-profiles-v1/);
  assert.match(model, /localStorage\.getItem\(JARVIS_SCREEN_LAYOUT_PROFILE_KEY\)/);
  assert.match(model, /localStorage\.setItem\(JARVIS_SCREEN_LAYOUT_PROFILE_KEY/);
  assert.match(model, /SCREEN_DESIGN_KEY/);
  assert.match(model, /delete root\.dataset\.jarvisScreenLayout/);
  assert.match(settings, /JARVIS_PRIMARY_SCREENS\.map/);
  assert.match(settings, /専用の配置として保存/);
  assert.match(settings, /端末操作・認証・Goal・Human Gateには触れません/);
  assert.doesNotMatch(settings, /fetch\(/);
  assert.doesNotMatch(settings, /\/api\//);
  assert.match(shell, /applyJarvisScreenLayoutProfile\(pathname/);
  assert.match(shell, /\[pathname\]/);
  assert.match(shell, /jarvis-screen-layout-profiles-changed/);
  assert.match(shell, /goriq-theme-changed/);
  assert.match(layout, /import "\.\/screen-layout-profiles\.css"/);
});
