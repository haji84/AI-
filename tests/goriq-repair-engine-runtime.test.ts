import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ollamaAdapterUrl = new URL("../scripts/goriq-ollama-repair.mjs", import.meta.url);
const windowsInstallerUrl = new URL("../scripts/install-goriq-local-repair-windows.ps1", import.meta.url);
const chatClientUrl = new URL("../scripts/goriq-chatgpt-repair-client.mjs", import.meta.url);
const runtimeWorkflowUrl = new URL("../.github/workflows/goriq-repair-engines-runtime.yml", import.meta.url);
const recoveryWorkflowUrl = new URL("../.github/workflows/goriq-pr-ci-recovery.yml", import.meta.url);

test("local repair adapter is bounded to AllowedPaths and local Ollama API", async () => {
  const source = await readFile(ollamaAdapterUrl, "utf8");
  assert.match(source, /AllowedPaths=/);
  assert.match(source, /127\.0\.0\.1:11434/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /writeFileSync/);
  assert.match(source, /allowedSet\.has\(path\)/);
});

test("ZBook installer provisions two local models and probes cloud fallback without making it mandatory", async () => {
  const source = await readFile(windowsInstallerUrl, "utf8");
  assert.match(source, /https:\/\/ollama\.com\/install\.ps1/);
  assert.match(source, /qwen2\.5-coder:1\.5b/);
  assert.match(source, /qwen2\.5-coder:3b/);
  assert.match(source, /gpt-oss:20b-cloud/);
  assert.match(source, /cloudFreeReady/);
  assert.doesNotMatch(source, /throw "Failed to pull required local repair model: \$CloudFreeModel"/);
});

test("Chat and Work repair client requests a diff and cannot directly push", async () => {
  const source = await readFile(chatClientUrl, "utf8");
  assert.match(source, /mode must be chat or work/);
  assert.match(source, /Return ONLY a valid unified git diff/);
  assert.match(source, /git", \["apply"/);
  assert.doesNotMatch(source, /git", \["push"/);
  assert.doesNotMatch(source, /git", \["commit"/);
});

test("runtime workflow installs ZBook local engines and refreshes the Mac Chat Work bridge", async () => {
  const source = await readFile(runtimeWorkflowUrl, "utf8");
  assert.match(source, /runs-on: \[self-hosted, Windows, X64\]/);
  assert.match(source, /install-goriq-local-repair-windows\.ps1/);
  assert.match(source, /runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(source, /install-macos-chatgpt-bridge\.sh/);
});

test("CI recovery grants only the extra Issue write authority needed by Chat Work queue", async () => {
  const source = await readFile(recoveryWorkflowUrl, "utf8");
  assert.match(source, /contents: write/);
  assert.match(source, /issues: write/);
  assert.match(source, /pull-requests: read/);
  assert.doesNotMatch(source, /deployments:\s*write|id-token:\s*write|secrets:\s*write/);
});
