import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Mac Builder launchd PATH includes Node and the resolved engine directory", async () => {
  const source = await readFile(new URL("../scripts/install-code-builder-macos.sh", import.meta.url), "utf8");
  assert.match(source, /NODE_DIR="\$\(dirname "\$NODE_BIN"\)"/);
  assert.match(source, /ENGINE_DIR=/);
  assert.match(source, /BUILDER_RUNTIME_PATH=/);
  assert.match(source, /<key>PATH<\/key><string>\$BUILDER_RUNTIME_PATH<\/string>/);
});
