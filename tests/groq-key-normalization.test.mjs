import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = "scripts/configure-groq-free-secret-windows.ps1";

test("Groq configurator uses clipboard-first input", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /Get-Clipboard -Raw/);
  assert.match(source, /Set-Clipboard -Value ''/);
  assert.match(source, /コピーできたら Enter/);
  assert.match(source, /右クリック貼り付け/);
});

test("Groq configurator normalizes clipboard whitespace before HTTP validation", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /\$plain = \$plain\.Trim\(\)/);
  assert.match(source, /Regex\]::Replace\(\$plain, '\[\\p\{Cc\}\\p\{Cf\}\\p\{Z\}\\s\]\+'/);
  assert.match(source, /\[\^\\x21-\\x7E\]/);
  assert.match(source, /Invisible whitespace\/control characters were removed/);
  assert.match(source, /ConvertTo-SecureString -String \$plain -AsPlainText -Force/);
  assert.match(source, /\$encrypted = \$normalizedSecure \| ConvertFrom-SecureString/);
  assert.doesNotMatch(source, /\$encrypted = \$secure \| ConvertFrom-SecureString/);
});

test("Groq configurator never prints the key value", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /Write-Host[^\n]*\$plain/);
  assert.doesNotMatch(source, /Write-Output[^\n]*\$plain/);
});
