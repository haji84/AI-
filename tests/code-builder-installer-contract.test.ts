import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = new URL("../scripts/install-code-builder-windows.ps1", import.meta.url);

test("ZBook code-builder installer is structurally singular and prefers cmd wrapper", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Start-Process -FilePath \$node/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
  assert.match(source, /worker\.pid/);
  assert.ok(source.includes("if ($oldPid -match '^\\d+$')"));
  assert.match(source, /CODE_BUILDER_ENGINE/);
  assert.match(source, /CODE_BUILDER_EXEC_TIMEOUT_MS/);
  assert.match(source, /Resolve-PreferredEnginePath/);
  assert.match(source, /ChangeExtension\(\$source, 'cmd'\)/);
  assert.doesNotMatch(source, /ChangeExtension\(\$source, 'ps1'\)/);
  assert.doesNotMatch(source, /Start-ScheduledTask -TaskName \$taskName/);
  assert.equal((source.match(/function Resolve-PreferredEnginePath/g) ?? []).length, 1);
  assert.equal((source.match(/\$launcherLines = @\(/g) ?? []).length, 1);
  assert.equal((source.match(/installedAt =/g) ?? []).length, 1);
  assert.equal((source.match(/param\(/g) ?? []).length >= 2, true);
});


test("persistent code-builder installers copy runtime policy dependency beside service import root", async () => {
  const [windows, mac, service] = await Promise.all([
    readFile(new URL("../scripts/install-code-builder-windows.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install-code-builder-macos.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/code-builder-worker-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /\.\.\/src\/orchestrator\/test-contract-evolution\.ts/);
  assert.match(windows, /test-contract-evolution\.ts/);
  assert.match(windows, /src\\orchestrator/);
  assert.match(mac, /test-contract-evolution\.ts/);
  assert.match(mac, /src\/orchestrator/);
});
