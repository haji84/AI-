import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("fixed JARVIS APK route proxies the resident Broker download", () => {
  assert.match(source, /jarvisBrokerFetch\("\/downloads\/jarvis-worker\.apk"/);
  assert.match(source, /application\/vnd\.android\.package-archive/);
  assert.match(source, /attachment; filename=jarvis-worker\.apk/);
  assert.match(source, /Cache-Control/);
});
