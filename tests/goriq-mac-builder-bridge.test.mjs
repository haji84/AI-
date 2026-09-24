import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("Mac resident runtime provisions a loopback-only bounded code Builder", () => {
  const installer = readFileSync(new URL("../scripts/install-code-builder-macos.sh", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../scripts/jarvis-mac-zero-touch-install.sh", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../src/orchestrator/runtime-builder-capability.ts", import.meta.url), "utf8");
  const verifier = readFileSync(new URL("../src/orchestrator/runtime-development-verifier.ts", import.meta.url), "utf8");

  assert.match(installer, /CODE_BUILDER_HOST<\/key><string>127\.0\.0\.1<\/string>/);
  assert.match(installer, /com\.gai\.code-builder-worker/);
  assert.match(installer, /tokenStoredLocally/);
  assert.match(installer, /WORKSPACE="\$ROOT\/workspace"/);
  assert.match(installer, /git clone --quiet "\$origin" "\$WORKSPACE"/);
  assert.match(installer, /Preserving in-progress isolated Builder workspace/);
  assert.doesNotMatch(installer, /CODE_BUILDER_ALLOW_NON_LOOPBACK/);
  assert.match(runtime, /Library", "Application Support", "GAIWorker", "code-builder", "token\.txt"/);

  const install = bootstrap.indexOf('install-code-builder-macos.sh');
  const broker = bootstrap.indexOf('cat >"$BROKER_PLIST"');
  assert.ok(install >= 0 && broker > install, "Mac Builder must be provisioned before Broker restart");
});

test("Production connectivity requires the live Direct Goal Bridge executor", () => {
  const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
  const connectivity = readFileSync(new URL("../src/app/api/jarvis/connectivity/route.ts", import.meta.url), "utf8");
  assert.match(broker, /directGoalBridge: \{ version: 1, executorReady:/);
  assert.match(broker, /jarvis-goal-executor\.ts/);
  assert.match(connectivity, /directGoalBridgeReady/);
  assert.match(connectivity, /health\?\.directGoalBridge\?\.version === 1/);
  assert.match(connectivity, /health\.directGoalBridge\.executorReady === true/);
  assert.match(connectivity, /brokerReachable && directGoalBridgeReady/);
});
