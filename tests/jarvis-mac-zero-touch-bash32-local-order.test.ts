import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("zero-touch tunnel fallback does not expand a local before Bash 3.2 assigns it", async () => {
  const source = await readFile(new URL("../scripts/jarvis-mac-zero-touch.sh", import.meta.url), "utf8");
  const start = source.indexOf("start_tunnel_fallback()");
  const end = source.indexOf("\n}", start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /local name="\$1" local_url="\$2" log="[^"]*\$\{name\}/);
  assert.match(block, /local name="\$1" local_url="\$2"\n\s*local log="\$STATE_ROOT\/\$\{name\}-tunnel\.log"/);
});
