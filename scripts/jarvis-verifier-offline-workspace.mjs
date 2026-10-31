#!/usr/bin/env node
/**
 * Bake this helper into the digest-pinned verifier image. Never run the copy
 * supplied by /source. All dependencies must already exist in that image;
 * this helper does not install packages, run lifecycle scripts or use network.
 */
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
  const diff = relative(root, path);
  return diff === "" || (!isAbsolute(diff) && diff !== ".." && !diff.startsWith(".." + sep));
};

const resourceFiles = { cpuMax: "cpu.max", cpuStat: "cpu.stat", pidsMax: "pids.max",
  pidsCurrent: "pids.current", memoryMax: "memory.max", memoryCurrent: "memory.current" };
const cpuStatKeys = new Set(["usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec"]);
const decimal = value => typeof value === "string" && /^[0-9]{1,24}$/.test(value);
function readResource(path) {
  const fd = openSync(path, "r"), bytes = Buffer.alloc(4097);
  try {
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 4096) throw Error("RESOURCE_BOUND");
    return bytes.subarray(0, length).toString("utf8");
  } finally { closeSync(fd); }
}

/** Observation only: a before-check snapshot cannot establish runtime CPU
 * throttling or observed test concurrency. No env, cmdline or arbitrary paths. */
export function collectVerifierResourceSnapshot({ platform = process.platform,
  parallelism = availableParallelism, readResource: read = readResource } = {}) {
  const observation = { version: 1, platform, availableParallelism: null,
    node24DefaultTestFileConcurrency: null, cgroup: {}, unavailable: [] };
  try {
    const count = parallelism();
    if (!Number.isInteger(count) || count < 1 || count > 65536) throw Error("RESOURCE_INVALID");
    observation.availableParallelism = count;
    // Pinned Node24 default, not an observation of worker start/end events.
    observation.node24DefaultTestFileConcurrency = Math.max(count - 1, 1);
  } catch { observation.unavailable.push("availableParallelism"); }
  for (const [key, file] of Object.entries(resourceFiles)) {
    try {
      if (platform !== "linux") throw Error("RESOURCE_UNAVAILABLE");
      const text = read("/sys/fs/cgroup/" + file);
      if (typeof text !== "string" || Buffer.byteLength(text) > 4096) throw Error("RESOURCE_BOUND");
      const value = text.trim();
      if (key === "cpuMax") {
        const fields = value.split(/\s+/);
        if (fields.length !== 2 || !(fields[0] === "max" || decimal(fields[0])) || !decimal(fields[1])) throw Error("RESOURCE_INVALID");
        observation.cgroup[key] = { quotaUsec: fields[0], periodUsec: fields[1] };
      } else if (key === "cpuStat") {
        const counters = {};
        for (const line of value.split("\n")) {
          const [name, counter, ...extra] = line.trim().split(/\s+/);
          if (!cpuStatKeys.has(name)) continue;
          if (!decimal(counter) || extra.length || Object.hasOwn(counters, name)) throw Error("RESOURCE_INVALID");
          counters[name] = counter;
        }
        if (!Object.keys(counters).length) throw Error("RESOURCE_UNAVAILABLE");
        observation.cgroup[key] = counters;
      } else {
        if (!(decimal(value) || (key.endsWith("Max") && value === "max"))) throw Error("RESOURCE_INVALID");
        observation.cgroup[key] = value;
      }
    } catch { observation.unavailable.push(key); }
  }
  return observation;
}

function plainPath(path) {
  if (typeof path !== "string" || !isAbsolute(path)) throw Error("VERIFIER_OFFLINE_PATH_UNSAFE");
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw Error("VERIFIER_OFFLINE_PATH_UNSAFE");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return absolute;
    cursor = parent;
  }
}

function manifest(root, name) {
  const file = join(root, name);
  if (!existsSync(file)) throw Error("VERIFIER_OFFLINE_MANIFEST_MISSING");
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 16 * 1024 * 1024)
    throw Error("VERIFIER_OFFLINE_MANIFEST_UNSAFE");
  const bytes = readFileSync(file);
  if (bytes.length !== info.size) throw Error("VERIFIER_OFFLINE_MANIFEST_UNSAFE");
  return bytes;
}

function sourceInventory(root) {
  const entries = [];
  let bytes = 0;
  function visit(directory, depth) {
    if (depth > 64) throw Error("VERIFIER_OFFLINE_SOURCE_LIMIT");
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), info = lstatSync(file);
      if (name.toLowerCase() === ".git" || name.toLowerCase() === "node_modules" || info.isSymbolicLink()
        || (!info.isDirectory() && !info.isFile())) throw Error("VERIFIER_OFFLINE_SOURCE_UNSAFE");
      bytes += info.isFile() ? info.size : 0;
      entries.push({ path: relative(root, file), directory: info.isDirectory(), executable: !!(info.mode & 0o111) });
      if (entries.length > 100_000 || bytes > 512 * 1024 * 1024) throw Error("VERIFIER_OFFLINE_SOURCE_LIMIT");
      if (info.isDirectory()) visit(file, depth + 1);
    }
  }
  visit(root, 0);
  return entries;
}

function validateModules(root) {
  let count = 0;
  function visit(directory, depth) {
    if (depth > 64) throw Error("VERIFIER_OFFLINE_DEPENDENCY_LIMIT");
    for (const name of readdirSync(directory)) {
      const file = join(directory, name), info = lstatSync(file);
      if (++count > 200_000) throw Error("VERIFIER_OFFLINE_DEPENDENCY_LIMIT");
      if (info.isSymbolicLink()) {
        let target;
        try { target = realpathSync(file); } catch { throw Error("VERIFIER_OFFLINE_DEPENDENCY_LINK_UNSAFE"); }
        if (!inside(root, target) || (!statSync(target).isFile() && !statSync(target).isDirectory()))
          throw Error("VERIFIER_OFFLINE_DEPENDENCY_LINK_UNSAFE");
      } else if (info.isDirectory()) visit(file, depth + 1);
      else if (!info.isFile()) throw Error("VERIFIER_OFFLINE_DEPENDENCY_UNSAFE");
    }
  }
  visit(root, 0);
  if (count === 0) throw Error("VERIFIER_OFFLINE_DEPENDENCIES_MISSING");
}

export function prepareOfflineVerifierWorkspace({ source, dependencies, destination }) {
  source = plainPath(source); dependencies = plainPath(dependencies); destination = plainPath(destination);
  if ([source, dependencies, destination].some((root, index, all) =>
    all.some((other, otherIndex) => index !== otherIndex && inside(root, other))))
    throw Error("VERIFIER_OFFLINE_PATH_UNSAFE");
  if (existsSync(destination)) throw Error("VERIFIER_OFFLINE_DESTINATION_NOT_NEW");
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw Error("VERIFIER_OFFLINE_SOURCE_UNSAFE");
  const modules = join(dependencies, "node_modules");
  if (!existsSync(dependencies) || !lstatSync(dependencies).isDirectory() || !existsSync(modules))
    throw Error("VERIFIER_OFFLINE_DEPENDENCIES_MISSING");
  if (lstatSync(modules).isSymbolicLink() || !lstatSync(modules).isDirectory())
    throw Error("VERIFIER_OFFLINE_DEPENDENCY_LINK_UNSAFE");
  const expected = new Map();
  for (const name of ["package.json", "pnpm-lock.yaml"]) {
    const bytes = manifest(dependencies, name);
    if (!bytes.equals(manifest(source, name))) throw Error("VERIFIER_OFFLINE_MANIFEST_MISMATCH");
    expected.set(name, bytes);
  }
  const entries = sourceInventory(source);
  validateModules(modules);
  mkdirSync(destination, { mode: 0o700 });
  chmodSync(destination, 0o700);
  for (const entry of entries) {
    const from = join(source, entry.path), target = join(destination, entry.path);
    if (lstatSync(from).isSymbolicLink()) throw Error("VERIFIER_OFFLINE_SOURCE_UNSAFE");
    if (entry.directory) {
      mkdirSync(target, { mode: 0o700 });
      chmodSync(target, 0o700);
    } else {
      copyFileSync(from, target, constants.COPYFILE_EXCL);
      chmodSync(target, entry.executable ? 0o700 : 0o600);
    }
  }
  // Bind the bytes actually copied, not only the earlier source read.
  for (const [name, bytes] of expected) {
    if (!bytes.equals(manifest(destination, name))) throw Error("VERIFIER_OFFLINE_MANIFEST_MISMATCH");
  }
  // This is the only newly created link. Its target is image-owned and remains
  // read-only under the runner's --read-only container filesystem contract.
  symlinkSync(modules, join(destination, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return { packageJsonSha256: hash(expected.get("package.json")), lockfileSha256: hash(expected.get("pnpm-lock.yaml")) };
}

if (process.argv[1] && basename(process.argv[1]) === "jarvis-verifier-offline-workspace.mjs") {
  try {
    if (process.argv.length !== 2) throw Error("VERIFIER_OFFLINE_ARGUMENTS_UNSUPPORTED");
    const result = prepareOfflineVerifierWorkspace({ source: "/source",
      dependencies: "/opt/goriq-verifier/dependencies", destination: "/tmp/verify" });
    process.stdout.write("VERIFIER_OFFLINE_READY:" + JSON.stringify(result) + "\n");
    process.stdout.write("VERIFIER_RUNTIME_RESOURCES:" + JSON.stringify(collectVerifierResourceSnapshot()) + "\n");
  } catch (error) {
    process.stderr.write("VERIFIER_OFFLINE_STOP:" + String(error.message).slice(0, 180) + "\n");
    process.exitCode = 1;
  }
}
