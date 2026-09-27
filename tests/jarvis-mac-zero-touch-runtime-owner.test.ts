import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("zero-touch preserves canonical launchd runtime ownership during tunnel rotation", async () => {
  const source = await readFile(new URL("../scripts/jarvis-mac-zero-touch.sh", import.meta.url), "utf8");
  const canonicalChecks = source.match(/launch_job_exists com\.aicompany\.jarvis-runtime/g) ?? [];
  const canonicalRestarts = source.match(/launchctl kickstart -k? "gui\/\$\(id -u\)\/com\.aicompany\.jarvis-runtime"/g) ?? [];
  assert.ok(canonicalChecks.length >= 2, "canonical runtime must be recognized at initial broker reconciliation and URL rotation");
  assert.ok(canonicalRestarts.length >= 2, "canonical runtime must be restarted through launchd instead of background fallback");
  const rotation = source.slice(source.indexOf('if [[ -n "$new_broker_url"'), source.indexOf("remote_healthy=false"));
  assert.match(rotation, /if launch_job_exists com\.aicompany\.jarvis-runtime; then[\s\S]*elif launch_job_exists com\.aicompany\.jarvis-broker; then[\s\S]*else[\s\S]*pkill -f 'scripts\/jarvis-broker\.ts'/);
});
