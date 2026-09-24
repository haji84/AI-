import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("Mac bootstrap fails closed when Direct Goal Bridge executor is missing", () => {
  const source = readFileSync(new URL("../scripts/jarvis-mac-zero-touch-install.sh", import.meta.url), "utf8");
  const sync = source.indexOf("git reset --hard origin/main");
  const guard = source.indexOf('[[ ! -f "$INSTALL_ROOT/scripts/jarvis-goal-executor.ts" ]]');
  const broker = source.indexOf('com.aicompany.jarvis-broker.plist');
  assert.ok(sync >= 0 && guard > sync && broker > guard);
  assert.match(source, /Missing scripts\/jarvis-goal-executor\.ts required by Direct Goal Bridge/);
  assert.match(source, /exit 8/);
});
