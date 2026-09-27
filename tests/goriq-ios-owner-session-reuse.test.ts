import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("native owner session restores durable routine auth without routine Face ID", async () => {
  const owner = await source("apps/ios-owner/Sources/OwnerCredentialRuntime.swift");
  assert.match(owner, /owner-durable-session/);
  assert.match(owner, /restoreDurableSession/);
  assert.match(owner, /ownerSessionEstablished = true/);
  assert.match(owner, /\.userPresence, \.privateKeyUsage/);
  assert.match(owner, /\/api\/owner-login\/trusted\/session/);
});

test("native Daily Driver invalidates cached owner session only after 401", async () => {
  const runtime = await source("apps/ios-owner/Sources/DailyDriverRuntime.swift");
  assert.match(runtime, /if result\.statusCode == 401 \{[\s\S]*invalidateOwnerSession\(\)[\s\S]*ensureOwnerSession\\(extendIdle: false\\)/);
  assert.match(runtime, /if result\.statusCode == 401 && retryAuth \{[\s\S]*invalidateOwnerSession\(\)[\s\S]*ensureOwnerSession\\(extendIdle: false\\)/);
});
