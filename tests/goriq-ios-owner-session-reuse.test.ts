import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("native owner session is reused between normal commands", async () => {
  const owner = await source("apps/ios-owner/Sources/OwnerCredentialRuntime.swift");
  assert.match(owner, /private var ownerSessionEstablished = false/);
  assert.match(owner, /if ownerSessionEstablished \{ return \}/);
  assert.match(owner, /ownerSessionEstablished = true/);
});

test("native Daily Driver invalidates cached owner session only after 401", async () => {
  const runtime = await source("apps/ios-owner/Sources/DailyDriverRuntime.swift");
  assert.match(runtime, /if result\.statusCode == 401 \{[\s\S]*invalidateOwnerSession\(\)[\s\S]*ensureOwnerSession\(\)/);
  assert.match(runtime, /if result\.statusCode == 401 && retryAuth \{[\s\S]*invalidateOwnerSession\(\)[\s\S]*ensureOwnerSession\(\)/);
});
