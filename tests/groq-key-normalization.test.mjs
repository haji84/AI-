import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = "scripts/configure-groq-free-secret-windows.ps1";

test("Groq configurator auto-watches clipboard in VSCode terminal", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /TERM_PROGRAM.*vscode/);
  assert.match(source, /VSCODE_PID/);
  assert.match(source, /Wait-ForGroqClipboardKey -TimeoutSeconds 120/);
  assert.match(source, /Do not paste the key into the terminal/);
  assert.match(source, /Groq key detected from Windows clipboard/);
  assert.doesNotMatch(source, /Substring\(0, 4\)/);
});

test("Groq configurator uses Windows clipboard API with PowerShell fallback", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /System\.Windows\.Forms\.Clipboard/);
  assert.match(source, /ContainsText\(\)/);
  assert.match(source, /GetText\(/);
  assert.match(source, /Clipboard\]::Clear\(\)/);
  assert.match(source, /Get-Clipboard -Raw/);
  assert.match(source, /Press Enter after copying the key/);
  assert.match(source, /right-click paste instead of Ctrl\+V/);
});

test("Groq configurator normalizes clipboard whitespace before HTTP validation", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /\$plain = \$plain\.Trim\(\)/);
  assert.match(source, /Regex\]::Replace\(\$plain, '\[\\p\{Cc\}\\p\{Cf\}\\p\{Z\}\\s\]\+'/);
  assert.match(source, /\[\^\\x21-\\x7E\]/);
  assert.match(source, /Invisible whitespace\/control characters were removed/);
  assert.match(source, /ConvertTo-SecureString -String \$plain -AsPlainText -Force/);
  assert.match(source, /\$encrypted = \$normalizedSecure \| ConvertFrom-SecureString/);
  assert.match(source, /StartsWith\('gsk_'/);
  assert.match(source, /HTTP 401/);
  assert.doesNotMatch(source, /\$encrypted = \$secure \| ConvertFrom-SecureString/);
});

test("Groq configurator never prints the key value", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /Write-Host[^\n]*\$plain/);
  assert.doesNotMatch(source, /Write-Output[^\n]*\$plain/);
});
