import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import process from "node:process";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as offlineWorkspace from "../scripts/jarvis-verifier-offline-workspace.mjs";

const prepare = async paths => (await import("../scripts/jarvis-verifier-offline-workspace.mjs"))
  .prepareOfflineVerifierWorkspace(paths);

test("resource observations distinguish Node default parallelism from cgroup CPU quota", () => {
  const files = { "cpu.max": "200000 100000\n", "cpu.stat": "usage_usec 123456\nnr_throttled 7\nthrottled_usec 1234\n",
    "pids.max": "128\n", "pids.current": "12\n", "memory.max": "2147483648\n", "memory.current": "9007199254740993\n" };
  const paths = [];
  const observation = offlineWorkspace.collectVerifierResourceSnapshot({ platform: "linux", parallelism: () => 8,
    readResource: path => { paths.push(path); return files[path.split("/").at(-1)]; } });
  assert.equal(observation.availableParallelism, 8);
  assert.equal(observation.node24DefaultTestFileConcurrency, 7);
  assert.deepEqual(observation.cgroup.cpuMax, { quotaUsec: "200000", periodUsec: "100000" });
  assert.equal(observation.cgroup.cpuStat.nr_throttled, "7");
  assert.equal(observation.cgroup.memoryCurrent, "9007199254740993");
  assert.deepEqual(observation.unavailable, []);
  assert.equal(paths.length, 6);
  assert.ok(paths.every(path => /^\/sys\/fs\/cgroup\/(cpu\.(max|stat)|pids\.(max|current)|memory\.(max|current))$/.test(path)));
});

test("unavailable or invalid resource data never discloses its raw contents", () => {
  const observation = offlineWorkspace.collectVerifierResourceSnapshot({ platform: "linux", parallelism: () => 2,
    readResource: path => { if (path.endsWith("cpu.max")) return "max 100000";
      if (path.endsWith("cpu.stat")) return "usage_usec 123\nunknown_secret sensitive-value\n";
      if (path.endsWith("pids.max")) return "max";
      if (path.endsWith("pids.current")) return "sensitive-value";
      if (path.endsWith("memory.max")) return "1".repeat(4097);
      throw Error("sensitive-value"); } });
  assert.deepEqual(observation.cgroup.cpuMax, { quotaUsec: "max", periodUsec: "100000" });
  assert.deepEqual(observation.cgroup.cpuStat, { usage_usec: "123" });
  assert.equal(observation.cgroup.pidsMax, "max");
  assert.deepEqual(observation.unavailable, ["pidsCurrent", "memoryMax", "memoryCurrent"]);
  assert.ok(!JSON.stringify(observation).includes("sensitive-value"));
  assert.ok(!JSON.stringify(observation).includes("unknown_secret"));
});

test("non-Linux resource observation does not attempt cgroup reads", () => {
  const observation = offlineWorkspace.collectVerifierResourceSnapshot({ platform: "win32", parallelism: () => 1,
    readResource: () => { throw Error("must not read"); } });
  assert.equal(observation.node24DefaultTestFileConcurrency, 1);
  assert.deepEqual(observation.cgroup, {});
  assert.equal(observation.unavailable.length, 6);
});

test("native resource file reads are capped before parsing and handles always close", t => {
  const reads = [], closed = [];
  t.mock.method(fs, "openSync", () => 123);
  t.mock.method(fs, "readSync", (fd, buffer, offset, length, position) => {
    reads.push({ fd, offset, length, position }); buffer.fill(49); return length;
  });
  t.mock.method(fs, "closeSync", fd => closed.push(fd));
  syncBuiltinESMExports();
  try {
    const observation = offlineWorkspace.collectVerifierResourceSnapshot({ platform: "linux", parallelism: () => 2 });
    assert.equal(reads.length, 6);
    assert.ok(reads.every(read => read.length === 4097 && read.offset === 0 && read.position === 0));
    assert.equal(closed.length, 6);
    assert.deepEqual(observation.cgroup, {});
    assert.equal(observation.unavailable.length, 6);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "goriq-offline-workspace-"));
  const source = join(root, "source"), dependencies = join(root, "dependencies"), destination = join(root, "verify");
  for (const dir of [source, dependencies]) fs.mkdirSync(dir);
  for (const dir of [source, dependencies]) {
    fs.writeFileSync(join(dir, "package.json"), '{"name":"offline-fixture","private":true}\n');
    fs.writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  }
  fs.mkdirSync(join(source, "scripts"));
  fs.writeFileSync(join(source, "scripts/check.mjs"), "export const value = 42;\n", { mode: 0o555 });
  const moduleDir = join(dependencies, "node_modules", ".pnpm", "fixture", "node_modules", "fixture");
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(join(moduleDir, "package.json"), '{"name":"fixture","main":"index.cjs"}\n');
  fs.writeFileSync(join(moduleDir, "index.cjs"), "module.exports = 42;\n");
  fs.symlinkSync(moduleDir, join(dependencies, "node_modules", "fixture"), process.platform === "win32" ? "junction" : "dir");
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.includes("goriq-offline-workspace-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, source, dependencies, destination };
}

test("missing preinstalled dependency bundle fails before creating an execution workspace", async t => {
  const f = fixture(t);
  await assert.rejects(() => prepare({ ...f, dependencies: join(f.root, "absent") }), /VERIFIER_OFFLINE_DEPENDENCIES_MISSING/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("matching package and lock bytes make prepared modules resolvable without installation", async t => {
  const f = fixture(t);
  const result = await prepare(f);
  assert.equal(createRequire(join(f.destination, "package.json"))("fixture"), 42);
  assert.equal(fs.readFileSync(join(f.destination, "scripts/check.mjs"), "utf8"), "export const value = 42;\n");
  assert.equal(result.packageJsonSha256, createHash("sha256").update(fs.readFileSync(join(f.source, "package.json"))).digest("hex"));
  assert.equal(result.lockfileSha256, createHash("sha256").update(fs.readFileSync(join(f.source, "pnpm-lock.yaml"))).digest("hex"));
  fs.writeFileSync(join(f.destination, "scripts/check.mjs"), "writable private execution copy\n");
  assert.equal(fs.readFileSync(join(f.source, "scripts/check.mjs"), "utf8"), "export const value = 42;\n");
  if (process.platform !== "win32") assert.equal(fs.statSync(join(f.destination, "scripts/check.mjs")).mode & 0o700, 0o700);
});

for (const file of ["package.json", "pnpm-lock.yaml"]) {
  test(`different ${file} bytes fail closed even when only whitespace changed`, async t => {
    const f = fixture(t);
    fs.appendFileSync(join(f.source, file), "\n");
    await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_MANIFEST_MISMATCH/);
    assert.equal(fs.existsSync(f.destination), false);
  });
}

test("a bundle with no installed node_modules is not usable", async t => {
  const f = fixture(t);
  const emptyBundle = join(f.root, "empty-bundle");
  fs.mkdirSync(emptyBundle);
  for (const file of ["package.json", "pnpm-lock.yaml"]) fs.copyFileSync(join(f.source, file), join(emptyBundle, file));
  await assert.rejects(() => prepare({ ...f, dependencies: emptyBundle }), /VERIFIER_OFFLINE_DEPENDENCIES_MISSING/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("candidate-provided node_modules cannot override the image dependency bundle", async t => {
  const f = fixture(t);
  fs.mkdirSync(join(f.source, "node_modules"));
  fs.writeFileSync(join(f.source, "node_modules", "injected.txt"), "untrusted dependency");
  await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_SOURCE_UNSAFE/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("source aliases and Git metadata cannot enter the execution workspace", async t => {
  for (const entry of ["alias", ".git"]) {
    const f = fixture(t);
    if (entry === "alias") fs.symlinkSync(f.dependencies, join(f.source, entry), process.platform === "win32" ? "junction" : "dir");
    else fs.mkdirSync(join(f.source, entry));
    await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_SOURCE_UNSAFE/);
    assert.equal(fs.existsSync(f.destination), false);
  }
});

test("dependency links must resolve within the prepared node_modules tree", async t => {
  const f = fixture(t);
  fs.symlinkSync(f.source, join(f.dependencies, "node_modules", "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_DEPENDENCY_LINK_UNSAFE/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("dependency-root aliases are refused even if their manifests match", async t => {
  const f = fixture(t), alias = join(f.root, "alias");
  fs.symlinkSync(f.dependencies, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => prepare({ ...f, dependencies: alias }), /VERIFIER_OFFLINE_PATH_UNSAFE/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("an existing execution workspace is never reused or overwritten", async t => {
  const f = fixture(t);
  fs.mkdirSync(f.destination);
  fs.writeFileSync(join(f.destination, "sentinel"), "preserve");
  await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_DESTINATION_NOT_NEW/);
  assert.equal(fs.readFileSync(join(f.destination, "sentinel"), "utf8"), "preserve");
});

test("source-copy substitution cannot pass the image manifest binding", async t => {
  const f = fixture(t), originalCopy = fs.copyFileSync;
  t.mock.method(fs, "copyFileSync", (source, target, flags) => {
    if (source === join(f.source, "package.json")) fs.appendFileSync(source, "\n");
    return originalCopy(source, target, flags);
  });
  syncBuiltinESMExports();
  await assert.rejects(() => prepare(f), /VERIFIER_OFFLINE_MANIFEST_MISMATCH/);
  assert.equal(fs.existsSync(join(f.destination, "node_modules")), false);
});
