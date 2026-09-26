import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const workflow = () => readFile(new URL("../.github/workflows/goriq-jarvis-production-sync.yml", import.meta.url), "utf8");

test("JARVIS Vercel Sync follows successful main CI and binds exact commit", async () => {
  const source = await workflow();
  assert.match(source, /workflow_run:\s*\n\s*workflows: \["CI"\]/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /SYNC_COMMIT_SHA:/);
  assert.match(source, /ref: \$\{\{ env\.SYNC_COMMIT_SHA \}\}/);
  assert.match(source, /"\$SYNC_COMMIT_SHA" \| shasum -a 256/);
});

test("JARVIS Vercel Sync includes native owner and trusted-device surfaces", async () => {
  const source = await workflow();
  for (const path of [
    "scripts/jarvis-broker.ts",
    "src/app/api/owner-login/**",
    "src/app/owner-auth.ts",
    "src/app/trusted-device-auth.ts",
    "src/app/fresh-trusted-owner-session.ts",
    "src/app/google-owner-*.ts",
    "src/app/owner-recovery-*.ts",
    "src/jarvis/trusted-device-registry.ts",
    "src/jarvis/google-owner-state-registry.ts",
    "apps/ios-owner/**",
  ]) {
    assert.ok(source.includes(path), `missing sync trigger path: ${path}`);
  }
});
