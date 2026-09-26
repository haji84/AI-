import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertLoopbackModelEndpoint,
  classifyLocalModelLiveEvidence,
  createBoundedOllamaGenerateRequest,
  parseBoundedLocalModelEdit,
} from "../src/orchestrator/local-model-development-acceptance.ts";
import {
  selectSingleAvailablePhysicalIPhone,
  verifyPhysicalIPhoneToolchainEvidence,
} from "../src/orchestrator/physical-iphone-live-acceptance.ts";
import { formatDevicectlFailure } from "../scripts/goriq-format-devicectl-failure.ts";

test("real local-model acceptance only permits a bounded declared edit", () => {
  assert.equal(assertLoopbackModelEndpoint("http://127.0.0.1:11434/api/generate"), "http://127.0.0.1:11434");
  assert.throws(() => assertLoopbackModelEndpoint("https://models.example.com/api/generate"), /loopback/);
  assert.deepEqual(
    parseBoundedLocalModelEdit(
      '{"path":"tests/fixtures/local-model-self-development.txt","content":"goriq-local-model-pass"}',
      "tests/fixtures/local-model-self-development.txt",
      "goriq-local-model-pass",
    ),
    { path: "tests/fixtures/local-model-self-development.txt", content: "goriq-local-model-pass" },
  );
  assert.throws(
    () => parseBoundedLocalModelEdit('{"path":"../escape","content":"goriq-local-model-pass"}', "tests/fixtures/local-model-self-development.txt", "goriq-local-model-pass"),
    /declared path/,
  );
  assert.throws(
    () => parseBoundedLocalModelEdit('{"path":"tests/fixtures/local-model-self-development.txt","content":"pretend-pass"}', "tests/fixtures/local-model-self-development.txt", "goriq-local-model-pass"),
    /verified target/,
  );
});

test("real local-model request disables reasoning and bounds the exact edit response", () => {
  assert.deepEqual(
    createBoundedOllamaGenerateRequest(
      "qwen3:4b",
      "Return the edit.",
      "tests/fixtures/local-model-self-development.txt",
      "goriq-local-model-pass",
    ),
    {
      model: "qwen3:4b",
      prompt: "Return the edit.",
      stream: false,
      think: false,
      format: {
        type: "object",
        properties: {
          path: { const: "tests/fixtures/local-model-self-development.txt" },
          content: { const: "goriq-local-model-pass" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      options: { temperature: 0, num_predict: 128 },
    },
  );
});

test("simulated loopback responses cannot become admissible real-model evidence", () => {
  const model = { digest: `sha256:${"a".repeat(64)}`, installedBytes: 2_000_000_000, loaded: true };
  const processProof = { pid: 42, executable: "C:\\Program Files\\Ollama\\ollama.exe", listenerPort: 11434 };
  assert.equal(classifyLocalModelLiveEvidence({ platform: "linux", githubActions: true, runnerEnvironment: "self-hosted", model, processProof }).admissible, false);
  assert.equal(classifyLocalModelLiveEvidence({ platform: "win32", githubActions: false, runnerEnvironment: "self-hosted", model, processProof }).admissible, false);
  assert.equal(classifyLocalModelLiveEvidence({ platform: "win32", githubActions: true, runnerEnvironment: "self-hosted", model, processProof }).admissible, true);
});

test("local-model acceptance drives the production durable runtime instead of assigning status labels", () => {
  const script = readFileSync("scripts/goriq-self-development-local-model-e2e.mjs", "utf8");
  assert.match(script, /new LocalDevelopmentBuilder/);
  assert.match(script, /new ResidentDevelopmentGoalHost/);
  assert.match(script, /new JsonFileDevelopmentJobStore/);
  assert.match(script, /bounded-acceptance-test\.mjs/);
  assert.match(script, /verificationExecutions/);
  assert.match(script, /GORIQ_TASK_AUTHORIZATION_TEXT/);
  assert.match(script, /process\.env\.ComSpec \|\| "cmd\.exe"/);
  assert.match(script, /taskAuthorization\.scopeId !== "issue:681"/);
  assert.match(script, /repositoryRoot !== workspace/);
  assert.doesNotMatch(script, /Issue #681を完成させて/);
  assert.doesNotMatch(script, /status:\s*["'](?:VERIFIED|READY_TO_PUBLISH)["']/);
});

test("manual live acceptance keeps ZBook and physical iPhone evidence separate and fail-closed", () => {
  const workflow = readFileSync(".github/workflows/goriq-self-development-live-acceptance.yml", "utf8");
  assert.match(workflow, /runs-on:\s*\[self-hosted, Windows, X64\]/);
  assert.match(workflow, /goriq-self-development-local-model-e2e\.mjs/);
  assert.match(workflow, /GORIQ_REQUIRE_ADMISSIBLE_REAL_MODEL:\s*"1"/);
  assert.match(workflow, /GAI_LOCAL_MODEL_NAME:\s*qwen3:4b/);
  assert.match(workflow, /runs-on:\s*\[self-hosted, macOS, ARM64\]/);
  assert.match(workflow, /"\$BREW_BIN" install xcodegen/);
  assert.match(workflow, /XCODEGEN_BIN/);
  assert.match(workflow, /xcrun xcdevice list/);
  assert.match(workflow, /com\.haji84\.jarvis\.iosworker/);
  assert.match(workflow, /physical-iphone-e2e/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /select-available-xcdevice/);
  assert.match(workflow, /IPHONE_EXPECTED_DEVICE_ID/);
  assert.match(workflow, /IPHONE_EXPECTED_BUILD_CHALLENGE/);
  assert.match(workflow, /approve_ephemeral_pairing/);
  assert.match(workflow, /devicectl device copy from/);
  assert.match(workflow, /goriq-verify-physical-iphone-evidence\.mjs/);
  assert.match(workflow, /xcodebuild[\s\S]*-allowProvisioningUpdates[\s\S]*CODE_SIGN_STYLE=Automatic build/);
  assert.match(workflow, /export IPHONE_BRIDGE_MASTER_KEY="\$EPHEMERAL_BRIDGE_KEY"/);
  assert.match(workflow, /::add-mask::\$EPHEMERAL_BRIDGE_KEY/);
  assert.doesNotMatch(workflow, /iphone-bridge-master\.key/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});

test("bridge-only simulated result cannot satisfy physical iPhone acceptance", () => {
  const result = {
    protocolVersion: 1,
    taskId: "task-1",
    deviceId: "device-1",
    ok: true,
    output: "physical-ios-worker-ok: challenge-1",
    evidence: { physicalDevice: "true", buildChallenge: "challenge-1", bundleIdentifier: "bundle-1" },
    completedAt: "2026-09-26T00:00:00.000Z",
    nonce: "nonce-1",
    signature: "signature-1",
  };
  const expected = { mainSha: "a".repeat(40), taskId: "task-1", deviceId: "device-1", challenge: "challenge-1", bundleIdentifier: "bundle-1" };
  assert.throws(() => verifyPhysicalIPhoneToolchainEvidence({ evidenceType: "physical-iphone-e2e", mainSha: expected.mainSha, result }, null, expected), /toolchain/);
  assert.deepEqual(verifyPhysicalIPhoneToolchainEvidence({ evidenceType: "physical-iphone-e2e", mainSha: expected.mainSha, result }, structuredClone(result), expected), result);
});

test("physical iPhone selection counts device rows rather than nested identifiers", () => {
  const iphone = (identifier: string, overrides: Record<string, unknown> = {}) => ({
    identifier,
    deviceProperties: { name: "iPhone", bootState: "booted" },
    hardwareProperties: { productType: "iPhone16,1", udid: `nested-${identifier}`, platform: "iOS" },
    connectionProperties: { pairingState: "paired", tunnelState: "connected" },
    ...overrides,
  });
  assert.equal(selectSingleAvailablePhysicalIPhone({ result: { devices: [iphone("phone-1")] } }), "phone-1");
  assert.equal(selectSingleAvailablePhysicalIPhone({ result: { devices: [{ identifier: "phone-new-schema", properties: { productType: "iPhone18,1", bootState: "booted", pairingState: "paired", tunnelState: "connected" } }] } }), "phone-new-schema");
  assert.throws(() => selectSingleAvailablePhysicalIPhone({ result: { devices: [] } }), /exactly one/);
  assert.throws(() => selectSingleAvailablePhysicalIPhone({ result: { devices: [iphone("phone-1"), iphone("phone-2")] } }), /exactly one/);
  assert.throws(() => selectSingleAvailablePhysicalIPhone({ result: { devices: [iphone("phone-1", { deviceProperties: { name: "iPhone", bootState: "shutdown" } })] } }), /exactly one/);
  assert.throws(() => selectSingleAvailablePhysicalIPhone({ result: { devices: [{ ...iphone("ipad-1"), hardwareProperties: { productType: "iPad14,1", platform: "iOS" } }] } }), /exactly one/);
});

test("devicectl failure diagnostics preserve the recovery action without leaking device identifiers", () => {
  const diagnostic = formatDevicectlFailure(
    1,
    "Error at /Users/alice/Library/Developer: CoreDeviceError 12045 for 00008110-001A2B3C4D5E601E. Unlock the device and reconnect it. UUID 123e4567-e89b-12d3-a456-426614174000",
    "physical iPhone selection",
  );
  assert.match(diagnostic, /physical iPhone selection failed \(exit 1\)/);
  assert.match(diagnostic, /Unlock the device and reconnect it/);
  assert.doesNotMatch(diagnostic, /alice|00008110|123e4567/i);
});
