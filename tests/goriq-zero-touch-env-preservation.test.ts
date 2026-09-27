import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("zero-touch updates managed connection keys without deleting self-development runtime settings", async () => {
  const source = await readFile(new URL("../scripts/jarvis-mac-zero-touch.sh", import.meta.url), "utf8");
  const start = source.indexOf("write_env()");
  const end = source.indexOf("launch_job_exists()", start);
  const block = source.slice(start, end);
  assert.equal(block.includes('cat >"$ENV_FILE"'), false);
  assert.equal(block.includes('local tmp="${ENV_FILE}.tmp.${BASHPID}"'), true);
  assert.equal(block.includes('awk -F='), true);
  assert.equal(block.includes('mv "$tmp" "$ENV_FILE"'), true);
  assert.equal(block.includes('"JARVIS_OWNER_TOKEN"'), true);
  assert.equal(block.includes('"JARVIS_REMOTE_PUBLIC_URL"'), true);
  assert.equal(block.includes("GORIQ_SELF_DEVELOPMENT_RELEASE_URL"), false);
  assert.equal(block.includes("GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN"), false);
});
