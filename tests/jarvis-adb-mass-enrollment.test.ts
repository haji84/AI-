import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enrollScript = "scripts/jarvis-adb-mass-enroll.sh";
const installScript = "scripts/jarvis-mac-zero-touch-install.sh";

test("ADB mass enrollment shell is syntactically valid", () => {
  for (const script of [enrollScript, installScript]) {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("ADB mass enrollment caps fleet at 100 and only promotes private wireless addresses", () => {
  const source = readFileSync(enrollScript, "utf8");
  assert.match(source, /JARVIS_ADB_MAX_NODES:-100/);
  assert.match(source, /ip\.is_private or ip\.is_link_local/);
  assert.match(source, /JARVIS_REMOTE_ALLOWED_SERIALS/);
  assert.match(source, /adb connect/);
});

test("Mac bootstrap installs platform tools and runs enrollment as a resident job", () => {
  const source = readFileSync(installScript, "utf8");
  assert.match(source, /android-platform-tools/);
  assert.match(source, /com\.aicompany\.jarvis-adb-enrollment/);
  assert.match(source, /StartInterval<\/key><integer>5<\/integer>/);
});
