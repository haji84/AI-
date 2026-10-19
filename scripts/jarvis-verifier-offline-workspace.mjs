#!/usr/bin/env node
/**
 * Bake this helper into the digest-pinned verifier image. Never run the copy
 * supplied by /source. All dependencies must already exist in that image;
 * this helper does not install packages, run lifecycle scripts or use network.
 */
import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
  const diff = relative(root, path);
  return diff === "" || (!isAbsolute(diff) && diff !== ".." && !diff.startsWith(".." + sep));
};

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
  } catch (error) {
    process.stderr.write("VERIFIER_OFFLINE_STOP:" + String(error.message).slice(0, 180) + "\n");
    process.exitCode = 1;
  }
}
