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

test("JARVIS production sync no longer depends on push path filters", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /\n  push:\s*\n/);
  assert.match(source, /workflow_run:\s*\n\s*workflows: \["CI"\]/);
  assert.match(source, /schedule:\s*\n\s*- cron: '\*\/5 \* \* \* \*'/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /runs-on: \[self-hosted, macOS, ARM64\]/);
});


test("JARVIS production code deploy is hosted and waits for successful main CI", async () => {
  const source = await workflow();
  assert.match(source, /deploy-code:\s*\n\s*if: github\.event_name == 'workflow_run'/);
  assert.match(source, /deploy-code:[\s\S]*concurrency:[\s\S]*group: jarvis-vercel-code-deploy[\s\S]*runs-on: ubuntu-latest/);
  assert.match(source, /sync:[\s\S]*group: jarvis-vercel-runtime-sync[\s\S]*runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(source, /Deploy exact verified main commit to JARVIS Production/);
  assert.match(source, /JARVIS_PRODUCTION_URL: https:\/\/jarvis-fawn-iota\.vercel\.app/);
  assert.match(source, /github\.event\.workflow_run\.head_sha/);
});
