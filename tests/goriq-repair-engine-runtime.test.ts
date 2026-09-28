import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ollamaAdapterUrl = new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url);
const windowsInstallerUrl = new URL("../scripts/install-goriq-local-repair-windows.ps1", import.meta.url);
const chatClientUrl = new URL("../scripts/goriq-chatgpt-repair-client.mjs", import.meta.url);
const runtimeWorkflowUrl = new URL("../.github/workflows/goriq-repair-engines-runtime.yml", import.meta.url);
const recoveryWorkflowUrl = new URL("../.github/workflows/goriq-pr-ci-recovery.yml", import.meta.url);
const groqAdapterUrl = new URL("../scripts/goriq-groq-repair.mjs", import.meta.url);
const chatWorkWorkerUrl = new URL("../.github/workflows/goriq-chat-work-repair-worker.yml", import.meta.url);

test("local repair adapter is bounded to AllowedPaths and local Ollama API", async () => {
  const source = await readFile(ollamaAdapterUrl, "utf8");
  assert.match(source, /AllowedPaths=/);
  assert.match(source, /127\.0\.0\.1:11434/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /writeFileSync/);
  assert.match(source, /allowedSet\.has\(path\)/);
});

test("ZBook installer provisions two local models without any cloud billing fallback", async () => {
  const source = await readFile(windowsInstallerUrl, "utf8");
  assert.match(source, /https:\/\/ollama\.com\/install\.ps1/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /qwen2\.5-coder:3b/);
  assert.doesNotMatch(source, /cloud|CloudFreeModel|pay-as-you-go/i);
});

test("learned repair persists verified patches and can replay them before model fallbacks", async () => {
  const recoveryUrl = new URL("../scripts/goriq-pr-ci-recovery.ts", import.meta.url);
  const source = await readFile(recoveryUrl, "utf8");
  assert.match(source, /repair-memory/);
  assert.match(source, /applyLearnedMemory/);
  assert.match(source, /persistLearnedMemory/);
  assert.match(source, /GORIQ-Recovery-Failure-Fingerprint/);
  assert.match(source, /runLearnedRepair/);
});

test("Chat and Work repair client requests a diff and cannot directly push", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /mode must be chat or work/);
  assert.match(source, /Return ONLY a valid unified git diff/);
  assert.match(source, /git", \["apply"/);
  assert.doesNotMatch(source, /git", \["push"/);
  assert.doesNotMatch(source, /git", \["commit"/);
  assert.match(source, /repos\/\$\{owner\}\/\$\{repo\}\/dispatches/);
  assert.match(source, /goriq-repair-\$\{mode\}/);
});

test("Chat and Work reuse one canonical 自動化 project conversation", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /GORIQ_AUTOMATION_PROJECT/);
  assert.match(source, /"自動化"/);
  assert.match(source, /REPAIR_CONVERSATION_TITLE/);
  assert.match(source, /findOrCreateAutomationConversation/);
  assert.match(source, /enqueueProjectRepair/);
  assert.match(source, /project: AUTOMATION_PROJECT/);
  assert.match(source, /encodeChatComment/);
  assert.match(source, /pendingOwnerMessageId: requestId/);
  assert.doesNotMatch(source, /state:\s*"closed"/);
});

test("runtime workflow installs ZBook local engines and refreshes the Mac Chat Work bridge", async () => {
  const source = await readFile(runtimeWorkflowUrl, "utf8");
  assert.match(source, /runs-on: \[self-hosted, Windows, X64\]/);
  assert.match(source, /install-goriq-local-repair-windows\.ps1/);
  assert.match(source, /runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(source, /install-macos-chatgpt-bridge\.sh/);
  assert.match(source, /goriq-chatgpt-bridge-health-check\.mjs/);
  assert.match(source, /learned-repair-smoke/);
  assert.match(source, /goriq-learned-repair-smoke\.mjs/);
  assert.match(source, /mac-bridge-post-cleanup-proof/);
  assert.match(source, /pgrep -alf "\$HOME\/\.ai-company\/runtime\/chatgpt-resident-bridge-v2\.mjs"/);
  assert.match(source, /launchctl print/);
  assert.match(source, /chat-work-repair-smoke:\s+needs: \[mac-bridge-post-cleanup-proof\][\s\S]*?permissions:[\s\S]*?contents: write[\s\S]*?issues: write[\s\S]*?runs-on: ubuntu-latest/);
  assert.doesNotMatch(source, /chat-work-repair-smoke:\s+needs: \[[^\]]*zbook-local-repair/);
  assert.match(source, /AFTER_CHAT/);
  assert.match(source, /AFTER_WORK/);
  assert.match(source, /free-external-repair-smoke:\s+runs-on: ubuntu-latest/);
  assert.doesNotMatch(source, /free-external-repair-smoke:\s+needs: \[zbook-local-repair\]/);
  assert.match(source, /GROQ_API_KEY_NOT_CONFIGURED/);
});

test("runtime smoke keeps top-level read-only and scopes dispatch write to Chat Work job", async () => {
  const source = await readFile(runtimeWorkflowUrl, "utf8");
  assert.match(source, /permissions:\s+contents: read\s+issues: write/);
  assert.match(source, /chat-work-repair-smoke:[\s\S]*?permissions:[\s\S]*?contents: write[\s\S]*?issues: write/);
  assert.doesNotMatch(source, /deployments:\s*write|id-token:\s*write/);
});

test("repository dispatch worker runs one bounded repair issue on Mac", async () => {
  const source = await readFile(chatWorkWorkerUrl, "utf8");
  assert.match(source, /repository_dispatch/);
  assert.match(source, /goriq-repair-chat/);
  assert.match(source, /goriq-repair-work/);
  assert.match(source, /runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(source, /AI_COMPANY_REPAIR_ONCE_ISSUE/);
  assert.match(source, /issues: write/);
  assert.doesNotMatch(source, /contents:\s*write/);
});

test("CI recovery grants only the extra Issue write authority needed by Chat Work queue", async () => {
  const source = await readFile(recoveryWorkflowUrl, "utf8");
  assert.match(source, /contents: write/);
  assert.match(source, /issues: write/);
  assert.match(source, /pull-requests: read/);
  assert.doesNotMatch(source, /deployments:\s*write|id-token:\s*write|secrets:\s*write/);
});

test("free external repair uses Groq Free Plan API and fails closed on rate limit", async () => {
  const source = await readFile(groqAdapterUrl, "utf8");
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(source, /qwen\/qwen3\.8-27b/);
  assert.match(source, /GROQ_API_KEY/);
  assert.match(source, /GORIQ_GROQ_FREE_LIMIT_EXHAUSTED/);
  assert.doesNotMatch(source, /billing|credit card|purchase/i);
});
