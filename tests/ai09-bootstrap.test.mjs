import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const hasPowerShell = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"], { timeout: 15000 }).status === 0;
for (const fixture of ["ai09-prepare-bootstrap-disk", "ai09-fetch-verified-bootstrap"]) {
  test(fixture + " isolated PowerShell fixtures", { skip: !hasPowerShell }, () => {
    const result = spawnSync(powershell, [
      "-NoProfile", "-File", path.join(root, "tests", fixture + ".test.ps1"), "-RepositoryRoot", root,
    ], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS/);
  });
}

const source = readFileSync(path.join(root, "scripts/ai09-prepare-bootstrap-disk.ps1"), "utf8");
const guest = source.match(/\$template = @'\r?\n([\s\S]*?)\r?\n'@/)[1]
  .replaceAll("__RUN_ID__", "a".repeat(32)).replaceAll("__FS_UUID__", "1234-ABCD").replaceAll("__PART_UUID__", "1234abcd-01");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const hasBash = spawnSync(bash, ["--version"], { timeout: 15000 }).status === 0;

test("guest shell syntax and complete identity gates before any file output", { skip: !hasBash }, () => {
  const result = spawnSync(bash, ["-n"], { input: guest, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const firstWrite = guest.indexOf("exec 3>/mnt/ai09-result.txt");
  for (const guard of ["ROOT_REQUIRED", "WRONG_GUEST", "SEED_NOT_MOUNTED", "-o FSTYPE", "-s LABEL", "-s UUID",
    "-s PARTUUID", "cat /mnt/seed.id", "EXISTING_RECEIPT_REFUSED"]) {
    assert.ok(guest.indexOf(guard) >= 0 && guest.indexOf(guard) < firstWrite, guard);
  }
  assert.match(guest, /ulimit -f 2048/);
  assert.doesNotMatch(guest, /\|\| true|GUEST CHECK COMPLETE/);
});

function runGuest(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), "ai09-guest-refusal-"));
  const file = path.join(dir, "fixture.sh");
  try {
    writeFileSync(file, prefix + guest, "utf8");
    return spawnSync(bash, [file.replaceAll("\\", "/")], { encoding: "utf8", timeout: 15000 });
  } finally {
    unlinkSync(file);
    rmdirSync(dir);
  }
}
test("wrong guest is rejected before mount or output access", { skip: !hasBash }, () => {
  const prefix = 'id() { echo 0; }\nhostname() { echo wrong-guest; }\n';
  const result = runGuest(prefix);
  assert.equal(result.status, 4, result.stdout + result.stderr);
  assert.match(result.stderr, /WRONG_GUEST/);
  assert.equal(result.stdout, "");
});

test("missing exact seed mount refuses before any receipt or network write", { skip: !hasBash }, () => {
  const prefix = 'id() { echo 0; }\nhostname() { echo 8484; }\nreadlink() { echo /mnt/bridge.sh; }\nfindmnt() { echo /; }\n';
  const result = runGuest(prefix);
  assert.equal(result.status, 6, result.stdout + result.stderr);
  assert.match(result.stderr, /SEED_NOT_MOUNTED/);
  assert.equal(result.stdout, "");
});
