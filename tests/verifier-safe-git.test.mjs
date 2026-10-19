import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeGit } from "../scripts/jarvis-verifier-safe-git.mjs";

const emptyConfig = process.platform === "win32" ? "NUL" : "/dev/null";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "goriq-safe-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root,
    encoding: "utf8", windowsHide: true, timeout: 8000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Verifier fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "tracked.txt"), "baseline\n");
  git("add", "tracked.txt");
  git("commit", "--quiet", "-m", "fixture");
  return { root, git };
}
function markerHook(root, name) {
  const marker = join(root, ".git", `${name}-called`);
  const hook = join(root, ".git", `${name}.sh`);
  const quote = value => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
  writeFileSync(hook, `#!/bin/sh\nprintf called > ${quote(marker)}\nprintf 'token\\000/\\000'\n`, { mode: 0o755 });
  return { marker, command: quote(hook) };
}
function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("status never invokes a repository fsmonitor hook", t => {
  const f = fixture(t), hook = markerHook(f.root, "fsmonitor");
  f.git("config", "core.fsmonitor", hook.command);
  writeFileSync(join(f.root, "tracked.txt"), "changed\n");
  assert.match(safeGit(f.root, ["status", "--porcelain", "-uall"]), /M tracked\.txt/);
  assert.equal(existsSync(hook.marker), false, "Git invoked the repository fsmonitor callback");
});

test("status refuses configured clean filters before executing them", t => {
  const f = fixture(t), hook = markerHook(f.root, "filter");
  f.git("config", "filter.probe.clean", hook.command);
  writeFileSync(join(f.root, ".gitattributes"), "*.txt filter=probe\n");
  writeFileSync(join(f.root, "tracked.txt"), "changed\n");
  assert.throws(() => safeGit(f.root, ["status", "--porcelain", "-uall"]),
    /VERIFIER_GIT_EXECUTION_CONFIG_UNSAFE/);
  assert.equal(existsSync(hook.marker), false);
});

test("status refuses execution configuration brought in by a local include", t => {
  const f = fixture(t), hook = markerHook(f.root, "included-filter");
  const included = join(f.root, ".git", "included.config");
  writeFileSync(included, `[filter "probe"]\n\tprocess = ${hook.command}\n`);
  f.git("config", "include.path", included);
  assert.throws(() => safeGit(f.root, ["status", "--porcelain", "-uall"]),
    /VERIFIER_GIT_EXECUTION_CONFIG_UNSAFE/);
  assert.equal(existsSync(hook.marker), false);
});

test("inherited Git config and repository overrides cannot redirect a verifier query", t => {
  const f = fixture(t), other = fixture(t), hook = markerHook(f.root, "environment");
  const expected = f.git("rev-parse", "HEAD");
  other.git("commit", "--allow-empty", "--quiet", "-m", "different repository");
  const globalConfig = join(f.root, ".git", "untrusted-global");
  writeFileSync(globalConfig, `[core]\n\tfsmonitor = ${hook.command}\n`);
  withEnv({ GIT_DIR: join(other.root, ".git"), GIT_WORK_TREE: other.root,
    GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: hook.command,
  }, () => {
    assert.equal(safeGit(f.root, ["rev-parse", "HEAD"]), expected);
    assert.equal(safeGit(f.root, ["status", "--porcelain", "-uall"]), "");
  });
  assert.equal(existsSync(hook.marker), false);
});

test("unsupported commands and option injection fail before changing the repository", t => {
  const f = fixture(t), original = readFileSync(join(f.root, "tracked.txt"), "utf8");
  for (const args of [["reset", "--hard"], ["status", "--porcelain", "-uall", "--ignored"],
    ["-c", "core.fsmonitor=anything", "status"], ["config", "user.name", "changed"]]) {
    assert.throws(() => safeGit(f.root, args), /VERIFIER_GIT_QUERY_NOT_ALLOWED/);
  }
  assert.equal(readFileSync(join(f.root, "tracked.txt"), "utf8"), original);
  assert.equal(f.git("config", "user.name"), "Verifier fixture");
});

test("supported detached-worktree queries preserve trimmed text results", t => {
  const f = fixture(t);
  f.git("checkout", "--detach", "--quiet");
  assert.equal(safeGit(f.root, ["rev-parse", "HEAD"]), f.git("rev-parse", "HEAD"));
  assert.equal(safeGit(f.root, ["branch", "--show-current"]), "");
  assert.equal(safeGit(f.root, ["rev-parse", "--show-toplevel"]), f.git("rev-parse", "--show-toplevel"));
});

test("submodule suppression must not silently hide a gitlink from status", t => {
  const f = fixture(t), revision = f.git("rev-parse", "HEAD");
  f.git("update-index", "--add", "--cacheinfo", `160000,${revision},nested`);
  assert.throws(() => safeGit(f.root, ["status", "--porcelain", "-uall"]),
    /VERIFIER_GIT_SUBMODULE_UNSUPPORTED/);
});

test("export inventory lists only cached paths with NUL separators", t => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".git", "info", "exclude"), "ignored.txt\n");
  writeFileSync(join(f.root, "ignored.txt"), "excluded\n");
  writeFileSync(join(f.root, "candidate.txt"), "untracked\n");
  assert.equal(safeGit(f.root, ["ls-files", "-z", "--cached"]), "tracked.txt\0");
  assert.throws(() => safeGit(f.root, ["ls-files", "--others"]), /VERIFIER_GIT_QUERY_NOT_ALLOWED/);
});

test("export inventory preserves leading whitespace in the first cached path", t => {
  const f = fixture(t);
  writeFileSync(join(f.root, " leading.txt"), "tracked whitespace path\n");
  f.git("add", "--", " leading.txt");
  assert.equal(safeGit(f.root, ["ls-files", "-z", "--cached"]), " leading.txt\0tracked.txt\0");
});
