import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("ZBook code-builder installer launches Node immediately and preserves logon persistence", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Start-Process -FilePath \$node/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
  assert.match(source, /worker\.pid/);
  assert.ok(source.includes("if ($oldPid -match '^\\d+$')"));
  assert.match(source, /CODE_BUILDER_ENGINE/);
  assert.match(source, /Resolve-PreferredEnginePath/);
  assert.match(source, /ChangeExtension\(\$source, 'ps1'\)/);
  assert.doesNotMatch(source, /Start-ScheduledTask -TaskName \$taskName/);
  assert.equal((source.match(/function Resolve-PreferredEnginePath/g) ?? []).length, 1);
  assert.equal((source.match(/\$launcherLines = @\(/g) ?? []).length, 1);
  assert.equal((source.match(/installedAt =/g) ?? []).length, 1);
});
