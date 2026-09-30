import assert from "node:assert/strict";import{readFile}from"node:fs/promises";import test from"node:test";import{URL}from"node:url";
const wf=()=>readFile(new URL("../.github/workflows/goriq-jarvis-production-sync.yml",import.meta.url),"utf8");
test("production sync triggers directly on every main merge",async()=>{const s=await wf();assert.match(s,/push:\s*\n\s*branches: \[main\]/);});
test("Mac runtime converges on exact main before endpoint sync",async()=>{const s=await wf();assert.match(s,/Update local JARVIS Broker to exact verified main/);assert.match(s,/ACTUAL_SHA="\$\(git rev-parse HEAD\)"/);assert.match(s,/RUNTIME_PREFLIGHT sha_mismatch/);assert.match(s,/git merge-base --is-ancestor/);assert.match(s,/launchctl kickstart -k/);assert.match(s,/runtimeRevision===process\.argv\[2\]/);assert.match(s,/runtime-active-main-sha/);assert.match(s,/GORIQ_RUNTIME_UPDATED/);});

test("Mac Production Sync automatically reconciles Supervisor and ChatGPT Bridge from exact main",async()=>{
  const s=await wf();
  assert.match(s,/Reconcile Mac persistence and ChatGPT bridge from exact main/);
  assert.match(s,/GAI_RUNNER_ROOT="\$HOME\/actions-runner" \.\/scripts\/install-macbook-persistence\.sh/);
  assert.match(s,/bash scripts\/install-macos-chatgpt-bridge\.sh/);
  assert.match(s,/com\.gai\.runner-supervisor/);
  assert.match(s,/com\.ai-company\.chatgpt-bridge/);
  assert.match(s,/chatgpt-resident-bridge-v2\.mjs/);
  assert.match(s,/chat-work-session-router\.ts/);
  assert.match(s,/MAC_RUNTIME_RECONCILE completed/);
});

test("Mac Production Sync emits sanitized resident Bridge diagnostics",async()=>{
  const s=await wf();
  assert.match(s,/Emit sanitized resident Bridge diagnostic/);
  assert.match(s,/chatgpt-bridge-execution\.json/);
  assert.match(s,/BRIDGE_DIAGNOSTIC_BEGIN/);
  assert.match(s,/assistantIdChanged/);
  assert.match(s,/composerRemaining/);
  assert.doesNotMatch(s,/pendingOwnerPayload/);
});
