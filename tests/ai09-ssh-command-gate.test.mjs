import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const script = fileURLToPath(new URL("../scripts/ai09-ssh-command-gate.sh", import.meta.url)).replaceAll("\\", "/");
const hasBash = spawnSync(bash, ["--version"], { timeout: 15000 }).status === 0;

function run(command, timeout = 15000) {
  return spawnSync(bash, ["--noprofile", "--norc", script], {
    env: { ...process.env, SSH_ORIGINAL_COMMAND: command, BASH_ENV: "", ENV: "" },
    encoding: "utf8", timeout,
  });
}

test("SSH gate rejects shell requests, arguments and command injection without executing them", { skip: !hasBash }, () => {
  for (const command of ["", "id", "sh", "ai09-identity-v1 extra", "ai09-identity-v1; printf INJECTED", "$(printf INJECTED)", "ai09-identity-v1\nprintf INJECTED"]) {
    const result = run(command);
    assert.equal(result.status, 64, result.stdout + result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /AI09_COMMAND_REFUSED/);
    assert.doesNotMatch(result.stderr, /INJECTED/);
  }
});

test("SSH identity command returns actual process identity and hostname", { skip: !hasBash }, () => {
  const result = run("ai09-identity-v1");
  const identity = spawnSync(bash, ["--noprofile", "--norc", "-c", "/usr/bin/id; /usr/bin/hostname"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(identity.status, 0, identity.stderr);
  assert.equal(result.stdout, "AI09_IDENTITY_V1\n" + identity.stdout);
  assert.equal(result.stderr, "");
});

test("SSH nonzero probe preserves distinct stdout stderr and exit status", { skip: !hasBash }, () => {
  const result = run("ai09-exit7-v1");
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "AI09_STDOUT_V1\n");
  assert.equal(result.stderr, "AI09_STDERR_V1\n");
});

test("SSH timeout probe is a real bounded process and does not report early success", { skip: !hasBash }, () => {
  const result = run("ai09-timeout-v1", 1000);
  assert.equal(result.status, null);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.stdout, "AI09_TIMEOUT_STARTED_V1\n");
  const completed = run("ai09-timeout-v1", 10000);
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(completed.stdout, "AI09_TIMEOUT_STARTED_V1\n");
  assert.equal(completed.stderr, "");
});
