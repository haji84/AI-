import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("Mac code Builder launchd bootstrap self-recovers before health verification", async () => {
  const source = await readFile(new URL("../scripts/install-code-builder-macos.sh", import.meta.url), "utf8");
  assert.equal(source.includes('plutil -lint "$PLIST"'), true);
  assert.equal(source.includes("retire_builder_service()"), true);
  assert.equal(source.includes("bootstrap_builder_service()"), true);
  assert.equal(source.includes("CODE_BUILDER_RECOVERY bootstrap_failed"), true);
  assert.equal(source.includes('launchctl bootout "$SERVICE_TARGET"'), true);
  assert.equal(source.includes('pkill -f "$SERVICE_PATH"'), true);
  assert.equal(source.includes('launchctl print "$SERVICE_TARGET"'), true);
});
