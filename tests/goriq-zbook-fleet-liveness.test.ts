import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/goriq-zbook-fleet-liveness.ps1", "utf8");
const workflow = readFileSync(".github/workflows/goriq-zbook-fleet-liveness.yml", "utf8");

test("ZBook liveness diagnosis exposes aggregate fleet evidence only", () => {
  for (const field of [
    "registeredTotal", "androidRegistered", "androidFresh",
    "newestAndroidHeartbeatAgeMs", "workerIngressListening",
    "productionTaskState", "configuredCommit",
  ]) {
    assert.match(script, new RegExp(field));
  }
  for (const forbidden of [
    "nodeId=", "label=", "publicKey", "privateKey", "workerIdentity",
    "JARVIS_OWNER_TOKEN=", "JARVIS_PRIVATE_WORKER_KEY_PATH=",
  ]) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(script, /Write-(?:Host|Output)\s+\$token/i);
  assert.match(script, /finally\s*\{[\s\S]*\$token=\$null/);
});

test("ZBook liveness workflow is read-only, exact-main and Windows scoped", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, X64\]/);
  assert.match(workflow, /Require exact current main/);
  assert.match(workflow, /goriq-zbook-fleet-liveness\.ps1/);
  assert.match(workflow, /Upload sanitized diagnosis/);
});


test("ZBook liveness diagnosis reports only a bounded sanitized failure stage", () => {
  for (const stage of [
    "config-discovery",
    "config-decrypt",
    "local-broker",
    "fleet-aggregation",
    "task-state",
  ]) {
    assert.match(script, new RegExp(`\\$stage = "${stage}"`));
  }
  assert.match(script, /reason=\("diagnostic_failed:" \+ \$stage\)/);
  assert.doesNotMatch(script, /\.Exception\.Message|\.ScriptStackTrace|Write-Error|Write-Warning\s+\$_/);
});


test("ZBook liveness diagnosis normalizes process-local PowerShell module path before DPAPI decrypt", () => {
  assert.match(script, /\$env:PSModulePath\s*=\s*Join-Path\s+\$PSHOME\s+["']Modules["']/);
  const moduleIndex = script.indexOf("$env:PSModulePath");
  const decryptIndex = script.indexOf("ConvertTo-SecureString");
  assert.ok(moduleIndex >= 0 && decryptIndex > moduleIndex);
});
