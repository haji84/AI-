import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ollamaAdapterUrl = new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url);
const windowsInstallerUrl = new URL("../scripts/install-goriq-local-repair-windows.ps1", import.meta.url);
const chatClientUrl = new URL("../scripts/goriq-chatgpt-repair-client.mjs", import.meta.url);
const runtimeWorkflowUrl = new URL("../.github/workflows/goriq-repair-engines-runtime.yml", import.meta.url);
const recoveryWorkflowUrl = new URL("../.github/workflows/goriq-pr-ci-recovery.yml", import.meta.url);
const groqAdapterUrl = new URL("../scripts/goriq-groq-repair.mjs", import.meta.url);
const autonomyWorkflowUrl = new URL("../.github/workflows/autonomy-mobile.yml", import.meta.url);
const groqWindowsSetupUrl = new URL("../scripts/configure-groq-free-secret-windows.ps1", import.meta.url);
const groqWindowsWrapperUrl = new URL("../scripts/invoke-node-with-groq-secret-windows.ps1", import.meta.url);
const groqWindowsLauncherUrl = new URL("../scripts/install-groq-one-click-windows.ps1", import.meta.url);
const groqBootstrapWorkflowUrl = new URL("../.github/workflows/goriq-groq-one-click-bootstrap.yml", import.meta.url);

test("local repair adapter is bounded to AllowedPaths and local Ollama API", async () => {
  const source = await readFile(ollamaAdapterUrl, "utf8");
  assert.match(source, /AllowedPaths=/);
  assert.match(source, /127\.0\.0\.1:11434/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /writeFileSync/);
  assert.match(source, /allowedSet\.has\(path\)/);
});

test("ZBook installer provisions missing local models and skips models already installed", async () => {
  const source = await readFile(windowsInstallerUrl, "utf8");
  assert.match(source, /https:\/\/ollama\.com\/install\.ps1/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /qwen2\.5-coder:3b/);
  assert.match(source, /function Get-InstalledModelNames/);
  assert.match(source, /if \(\$model -in \$models\)/);
  assert.match(source, /skipping pull/);
  assert.match(source, /Pulling missing local repair model/);
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

test("Chat Work diff extraction preserves the terminal newline required by git apply", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /return normalized \? `\$\{normalized\}\\n` : ""/);
  assert.doesNotMatch(source, /return diffMatch\?\.\[1\]\) return diffMatch\[1\]\.trim/);
});

test("Chat Work patch application tolerates omitted EOF markers without bypassing context", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /"apply", "--whitespace=nowarn", "--inaccurate-eof", "-"/);
  assert.doesNotMatch(source, /--reject|--3way/);
});

test("Chat and Work repair client requests a diff and cannot directly push", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /mode must be chat or work/);
  assert.match(source, /Return ONLY a valid unified git diff/);
  assert.match(source, /export function extractUnifiedDiff/);
  assert.match(source, /diff --git \[\\s\\S\]\*/);
  assert.match(source, /const patch = extractUnifiedDiff\(answer\)/);
  assert.match(source, /git", \["apply"/);
  assert.doesNotMatch(source, /git", \["push"/);
  assert.doesNotMatch(source, /git", \["commit"/);
  assert.match(source, /repos\/\$\{owner\}\/\$\{repo\}\/dispatches/);
  assert.match(source, /goriq-repair-\$\{mode\}/);
  assert.match(source, /project: projectName/);
  assert.match(source, /AI_COMPANY_CHATGPT_PROJECT_NAME/);
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
  assert.match(source, /free-external-repair-smoke:[\s\S]*?needs: \[zbook-local-repair\][\s\S]*?runs-on: \[self-hosted, Windows, X64\]/);
  assert.match(source, /invoke-node-with-groq-secret-windows\.ps1/);
  assert.match(source, /GORIQ_GROQ_MODEL: qwen\/qwen3\.8-27b/);
  assert.match(source, /AI_COMPANY_CHATGPT_PROJECT_NAME: 自動化/);
  assert.doesNotMatch(source, /goriq-chat-work-repair-worker\.yml/);
});

test("runtime smoke keeps top-level read-only and scopes dispatch write to Chat Work job", async () => {
  const source = await readFile(runtimeWorkflowUrl, "utf8");
  assert.match(source, /permissions:\s+contents: read\s+issues: write/);
  assert.match(source, /chat-work-repair-smoke:[\s\S]*?permissions:[\s\S]*?contents: write[\s\S]*?issues: write/);
  assert.doesNotMatch(source, /deployments:\s*write|id-token:\s*write/);
});

test("existing Mobile Autonomy workflow owns bounded project Chat Work repair dispatch", async () => {
  const source = await readFile(autonomyWorkflowUrl, "utf8");
  assert.match(source, /goriq-repair-chat/);
  assert.match(source, /goriq-repair-work/);
  assert.match(source, /project-chat-work-repair/);
  assert.match(source, /runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(source, /AI_COMPANY_REPAIR_ONCE_ISSUE/);
  assert.match(source, /AI_COMPANY_CHATGPT_PROJECT_NAME: 自動化/);
  assert.match(source, /github\.event\.action == 'ai-autonomy-run'/);
});

test("CI recovery grants only the extra Issue write authority needed by Chat Work queue", async () => {
  const source = await readFile(recoveryWorkflowUrl, "utf8");
  assert.match(source, /contents: write/);
  assert.match(source, /issues: write/);
  assert.match(source, /pull-requests: read/);
  assert.match(source, /invoke-node-with-groq-secret-windows\.ps1/);
  assert.doesNotMatch(source, /secrets\.GROQ_API_KEY/);
  assert.doesNotMatch(source, /deployments:\s*write|id-token:\s*write|secrets:\s*write/);
});

test("Windows Groq setup validates and stores the Free Plan key only as local DPAPI ciphertext", async () => {
  const windows = await readFile(groqWindowsSetupUrl, "utf8");
  assert.match(windows, /Read-Host 'Groq API key' -AsSecureString/);
  assert.match(windows, /https:\/\/api\.groq\.com\/openai\/v1\/models/);
  assert.match(windows, /qwen\/qwen3\.8-27b/);
  assert.match(windows, /ConvertFrom-SecureString/);
  assert.match(windows, /GORIQ\\secrets/);
  assert.match(windows, /groq\.dpapi/);
  assert.doesNotMatch(windows, /gh secret set|GROQ_API_KEY stored as a GitHub Actions repository secret/);
  assert.doesNotMatch(windows, /git add|git commit|Set-Content.*plain|Write-Host.*\$plain/i);
});

test("Groq local secret wrapper decrypts only for the bounded Node child process", async () => {
  const source = await readFile(groqWindowsWrapperUrl, "utf8");
  assert.match(source, /ConvertTo-SecureString/);
  assert.match(source, /GetNetworkCredential\(\)\.Password/);
  assert.match(source, /::add-mask::/);
  assert.match(source, /Remove-Item Env:GROQ_API_KEY/);
  assert.match(source, /GORIQ_GROQ_LOCAL_SECRET_NOT_CONFIGURED/);
  assert.match(source, /InputText/);
  assert.match(source, /Workspace/);
});

test("dedicated Groq workflow owns launcher install and Groq repair smoke", async () => {
  const launcher = await readFile(groqWindowsLauncherUrl, "utf8");
  const runtime = await readFile(runtimeWorkflowUrl, "utf8");
  const groqWorkflow = await readFile(groqBootstrapWorkflowUrl, "utf8");
  assert.match(launcher, /GORIQ Groq設定\.cmd/);
  assert.match(launcher, /ExecutionPolicy Bypass/);
  assert.match(launcher, /configure-groq-free-secret-windows\.ps1/);
  assert.doesNotMatch(runtime, /Install one-click Groq setup launcher/);
  assert.match(groqWorkflow, /Install Groq one-click launcher/);
  assert.match(groqWorkflow, /groq-repair-smoke:/);
  assert.match(groqWorkflow, /goriq-groq-repair\.mjs/);
  assert.match(groqWorkflow, /invoke-node-with-groq-secret-windows\.ps1/);
});

test("free external repair uses Groq Free Plan API and fails closed on rate limit", async () => {
  const source = await readFile(groqAdapterUrl, "utf8");
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(source, /qwen\/qwen3\.8-27b/);
  assert.match(source, /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(source, /GROQ_API_KEY/);
  assert.match(source, /GORIQ_GROQ_FREE_LIMIT_EXHAUSTED/);
  assert.doesNotMatch(source, /billing|credit card|purchase/i);
});

test("repair runtimes prefer the newest execution and do not let stale runs block fixes", async () => {
  const runtime = await readFile(runtimeWorkflowUrl, "utf8");
  const autonomy = await readFile(new URL("../.github/workflows/autonomy-mobile.yml", import.meta.url), "utf8");
  assert.match(runtime, /concurrency:\s+group: goriq-repair-engines-runtime\s+cancel-in-progress: true/);
  assert.match(autonomy, /project-chat-work-repair:[\s\S]*?group: goriq-project-repair-\$\{\{ github\.event\.client_payload\.issue_number \|\| github\.run_id \}\}[\s\S]*?cancel-in-progress: true/);
});

test("Groq setup-only paths do not trigger the heavy repair-runtime workflow", async () => {
  const runtime = await readFile(runtimeWorkflowUrl, "utf8");
  const trigger = runtime.match(/on:\s*\n\s*push:[\s\S]*?\n\s*workflow_dispatch:/)?.[0] ?? "";
  assert.doesNotMatch(trigger, /configure-groq-free-secret-windows\.ps1/);
  assert.doesNotMatch(trigger, /install-groq-one-click-windows\.ps1/);
  assert.doesNotMatch(trigger, /goriq-groq-repair\.mjs/);
  assert.doesNotMatch(trigger, /invoke-node-with-groq-secret-windows\.ps1/);
});
