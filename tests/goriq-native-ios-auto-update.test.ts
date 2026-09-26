import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const workflow = () => readFile(new URL("../.github/workflows/iphone-owner-auto-update.yml", import.meta.url), "utf8");

test("native iPhone auto-update is main-CI gated and pins the exact commit", async () => {
  const yml = await workflow();
  assert.match(yml, /workflow_run:/);
  assert.match(yml, /workflows: \["CI"\]/);
  assert.match(yml, /conclusion == 'success'/);
  assert.match(yml, /git merge-base --is-ancestor/);
  assert.match(yml, /native-ios-installed-main-sha/);
});

test("auto-update fails closed for sensitive or unclassified iOS changes", async () => {
  const yml = await workflow();
  assert.match(yml, /eligible-minor-ios-change/);
  assert.match(yml, /sensitive-or-unclassified-ios-change/);
  assert.match(yml, /OwnerCredentialRuntime/);
  assert.doesNotMatch(yml, /JARVIS_OWNER_SECRET|AI_COMPANY_OWNER_SECRET/);
});

test("auto-update preserves bundle identity and requires exactly one reachable iPhone", async () => {
  const yml = await workflow();
  assert.match(yml, /com\.haji84\.jarvis\.iosowner/);
  assert.match(yml, /len\(phones\)==1/);
  assert.match(yml, /device install app/);
  assert.match(yml, /device process launch/);
  assert.match(yml, /IPHONE_AUTO_UPDATE_VERIFIED/);
});
