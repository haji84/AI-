import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";

const home = "/tmp/goriq-verifier-home";
const cache = home + "/.cache/node-compile-cache";
const versionedCache = cache + "/v24.19.0-x64-1234abcd-65534";
const oldHomePaths = [home, home + "/.cache", home + "/.config", home + "/.local", home + "/.local/share"];

function imageInitializer() {
  const dockerfile = fs.readFileSync(new URL("./fixtures/verifier-image/Dockerfile", import.meta.url), "utf8");
  const start = dockerfile.indexOf("RUN printf '%s\\n' \\\n");
  const end = dockerfile.indexOf("    > /opt/goriq-verifier/prepare-home.cjs", start);
  assert.ok(start >= 0 && end > start, "the test must execute the image-generated initializer");
  return dockerfile.slice(start, end).split("\n").slice(1).filter(Boolean).map(line => {
    const literal = /^ {4}'([^']*)' \\$/.exec(line);
    assert.ok(literal, "initializer printf entries must remain literal JavaScript");
    return literal[1];
  }).join("\n") + "\n";
}

function fixture(t, options = {}) {
  // Real files/directories stay under this owned private temp root. The image's
  // fixed Linux path, UID/GID and native process-global cache API are boundary
  // doubles: this test never writes the host's real image home or enables its
  // global compile cache. Actual API/container behavior is verified separately.
  const root = fs.mkdtempSync(join(tmpdir(), "goriq-image-cache-"));
  const actualHome = join(root, "home"), metadata = new Map(), events = [];
  const state = { candidateStarted: false, requests: [], effective: options.preEnabled };
  const physical = logical => {
    assert.ok(logical === home || logical.startsWith(home + "/"), "initializer path escaped its fixed home");
    return join(actualHome, ...logical.slice(home.length).split("/").filter(Boolean));
  };
  const stat = logical => {
    const info = fs.lstatSync(physical(logical)), changed = metadata.get(logical) ?? {};
    // Windows cannot supply Linux permission bits; retain the closed image
    // metadata contract there. On Linux the permission observations are real.
    const mode = process.platform === "win32" ? (info.mode & ~0o777) | (changed.mode ?? 0o700) : info.mode;
    return Object.assign(Object.create(info), { mode, uid: changed.uid ?? 65534, gid: changed.gid ?? 65534 });
  };
  const nativeModule = {
    constants: { compileCacheStatus: { FAILED: 0, ENABLED: 1, ALREADY_ENABLED: 2, DISABLED: 3 } },
    getCompileCacheDir: () => state.effective,
    enableCompileCache: request => {
      events.push({ kind: "enable" }); state.requests.push({ ...request });
      const status = options.status ?? 1;
      if (status === 1 || status === 2) state.effective = options.effective ?? versionedCache;
      return { status, directory: options.directory ?? cache, ...(status === 0 ? { message: "public fixture failure" } : {}) };
    },
  };
  const imageFs = {
    mkdirSync: (logical, settings) => {
      events.push({ kind: "mkdir", path: logical });
      fs.mkdirSync(physical(logical), settings);
      metadata.set(logical, { ...(metadata.get(logical) ?? {}), mode: settings.mode });
    },
    lstatSync: logical => { events.push({ kind: "validate", path: logical }); return stat(logical); },
    realpathSync: logical => {
      const resolved = fs.realpathSync(physical(logical)), child = relative(actualHome, resolved);
      return child === "" ? home : !child.startsWith(".." + sep) && child !== ".." ? home + "/" + child.split(sep).join("/") : resolved;
    },
  };
  const execute = () => {
    state.candidateStarted = false;
    runInNewContext(imageInitializer() + "\ncandidateStarted();\n", {
      process: { getuid: () => options.uid ?? 65534, getgid: () => options.gid ?? 65534, version: "v24.19.0", arch: "x64", env: {} },
      require: name => {
        if (name === "node:fs") return imageFs;
        if (name === "node:module") return nativeModule;
        if (name === "node:v8") return { cachedDataVersionTag: () => 0x1234abcd };
        throw Error("unexpected image initializer dependency");
      },
      candidateStarted: () => { state.candidateStarted = true; },
    }, { timeout: 1000 });
  };
  const prepare = (logical, kind = "directory", changed = {}) => {
    fs.mkdirSync(dirname(physical(logical)), { recursive: true, mode: 0o700 });
    if (kind === "symlink") {
      const target = fs.mkdtempSync(join(root, "public-target-"));
      fs.symlinkSync(target, physical(logical), process.platform === "win32" ? "junction" : "dir");
    } else if (kind === "file") fs.writeFileSync(physical(logical), "public fixture\n");
    else fs.mkdirSync(physical(logical), { mode: changed.mode ?? 0o700 });
    if (kind === "directory" && changed.mode !== undefined) fs.chmodSync(physical(logical), changed.mode);
    metadata.set(logical, changed);
  };
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    assert.ok(root.includes("goriq-image-cache-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { execute, prepare, stat, state, events };
}

test("the image enables a private version-specific compile cache after validating its existing home", t => {
  const f = fixture(t); f.execute();
  assert.deepEqual(f.state.requests, [{ directory: cache, portable: false }]);
  assert.equal(f.state.effective, versionedCache);
  assert.equal(f.state.candidateStarted, true);
  for (const path of [cache, versionedCache]) assert.equal(f.stat(path).mode & 0o777, 0o700);
  const enabled = f.events.findIndex(event => event.kind === "enable");
  for (const path of oldHomePaths) {
    const validated = f.events.findIndex(event => event.kind === "validate" && event.path === path);
    assert.ok(validated >= 0 && validated < enabled);
  }
});

test("valid private cache paths survive another Node startup without being repaired", t => {
  const f = fixture(t); f.prepare(versionedCache);
  f.execute();
  assert.equal(f.state.candidateStarted, true);
  assert.equal(f.state.effective, versionedCache);
  assert.equal(f.stat(cache).mode & 0o777, 0o700);
  assert.equal(f.stat(versionedCache).mode & 0o777, 0o700);
  assert.equal(f.state.requests.length, 1);
});

test("unsafe home identity or paths stop before cache setup and candidate execution", t => {
  for (const options of [{ uid: 1000 }, { gid: 1000 }]) {
    const f = fixture(t, options);
    assert.throws(f.execute, /VERIFIER_HOME_/);
    assert.equal(f.state.candidateStarted, false); assert.equal(f.state.requests.length, 0);
  }
  const f = fixture(t); f.prepare(home, "directory", { mode: 0o755 });
  assert.throws(f.execute, /VERIFIER_HOME_/);
  assert.equal(f.state.candidateStarted, false); assert.equal(f.state.requests.length, 0);
});

test("an unsafe cache base is refused before enabling the cache or running the candidate", t => {
  for (const [kind, changed] of [["symlink", {}], ["file", {}], ["directory", { mode: 0o755 }], ["directory", { uid: 1000 }], ["directory", { gid: 1000 }]]) {
    const f = fixture(t); f.prepare(cache, kind, changed);
    assert.throws(f.execute, /VERIFIER_CACHE_/);
    assert.equal(f.state.candidateStarted, false); assert.equal(f.state.requests.length, 0);
  }
});

test("an unsafe versioned cache path is refused before enabling or candidate execution", t => {
  for (const [kind, changed] of [["symlink", {}], ["file", {}], ["directory", { mode: 0o755 }], ["directory", { uid: 1000 }]]) {
    const f = fixture(t); f.prepare(versionedCache, kind, changed);
    assert.throws(f.execute, /VERIFIER_CACHE_/);
    assert.equal(f.state.candidateStarted, false); assert.equal(f.state.requests.length, 0);
  }
});

test("an already active external compile cache cannot be adopted by the image initializer", t => {
  const f = fixture(t, { preEnabled: "/public-untrusted-cache" });
  assert.throws(f.execute, /VERIFIER_CACHE_/);
  assert.equal(f.state.candidateStarted, false); assert.equal(f.state.requests.length, 0);
});

test("failed disabled or unexpected already-enabled cache results stop the candidate", t => {
  for (const status of [0, 2, 3]) {
    const f = fixture(t, { status });
    assert.throws(f.execute, /VERIFIER_CACHE_/);
    assert.equal(f.state.candidateStarted, false);
    assert.equal(f.state.requests.length, 1);
  }
});

test("a mismatched native cache directory cannot continue into candidate execution", t => {
  for (const options of [{ directory: "/public-other-cache" }, { effective: "/public-other-cache/version" }]) {
    const f = fixture(t, options);
    assert.throws(f.execute, /VERIFIER_CACHE_/);
    assert.equal(f.state.candidateStarted, false);
    assert.equal(f.state.requests.length, 1);
  }
});
