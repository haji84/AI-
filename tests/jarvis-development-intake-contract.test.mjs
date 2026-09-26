import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");

test("Broker connects durable device development intake to trusted Goal execution", () => {
  assert.match(source, /JsonFileDeviceDevelopmentInbox/);
  assert.match(source, /\/api\/jarvis\/admin\/development-intake/);
  assert.match(source, /store\.getWorkerIdentity\(deviceId\)/);
  assert.match(source, /deviceDevelopmentIntake\.receive/);
  assert.match(source, /scheduleGoalExecution\(decision/);
});
