import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("ZBook code-builder installer launches immediately and preserves logon persistence", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(source, /worker\.pid/);
  assert.doesNotMatch(source, /Start-ScheduledTask -TaskName \$taskName/);
});
