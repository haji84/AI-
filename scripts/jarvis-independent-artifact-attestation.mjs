/** Generic read-only, independent-process artifact attestation primitive.
 * The caller must run this module in a separately launched verifier process.
 * It checks bytes and Git state. It NEVER certifies executable behavior,
 * repository checks, OS isolation, reviewer independence or release readiness.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, readSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { localCandidateIdentity } from "../src/orchestrator/local-candidate-identity.ts";
import { safeGit } from "./jarvis-verifier-safe-git.mjs";

const git = (root, ...args) => safeGit(root,args);

function safeRelative(value) {
  return typeof value === "string"
    && /^(?:src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(value)
    && !value.split("/").some(s => !s || s === "." || s === "..");
}

/** Explicit v2 scope only; absent retains the original create-only contract. */
export function validateTrackedEditsManifest(value) {
  if (value === undefined) return [];
  const exact = (object, keys) => !!object && typeof object === "object" && !Array.isArray(object)
    && Object.keys(object).sort().join(",") === keys;
  const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!exact(value,"files,version") || value.version !== 2 || !Array.isArray(value.files)
    || !value.files.length || value.files.length > 32 || value.files.some(file =>
      !exact(file,"afterSha256,beforeSha256,path") || !safeRelative(file.path)
      || !digest(file.beforeSha256) || !digest(file.afterSha256) || file.beforeSha256 === file.afterSha256)
    || new Set(value.files.map(file => file.path)).size !== value.files.length) {
    throw Error("INDEPENDENT_ARTIFACT_SCOPE_INVALID");
  }
  return [...value.files].sort((a,b) => a.path.localeCompare(b.path));
}

export function attestLocalCandidate({ workspace, baseRevision, targetPath, allowedUntracked, trackedEdits, maxBytes = 131072 }) {
  const edits = validateTrackedEditsManifest(trackedEdits), paths = [...(Array.isArray(allowedUntracked) ? allowedUntracked : []), ...edits.map(edit => edit.path)];
  if (typeof workspace !== "string" || !isAbsolute(workspace) ||
      !/^[0-9a-f]{40}$/.test(baseRevision) ||
      !safeRelative(targetPath) ||
      !Array.isArray(allowedUntracked) || paths.length < 1 || paths.length > 32 ||
      allowedUntracked.length > 32 || allowedUntracked.some(p => !safeRelative(p)) ||
      new Set(allowedUntracked).size !== allowedUntracked.length ||
      new Set(paths).size !== paths.length || !paths.includes(targetPath) ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 131072) {
    throw Error("INDEPENDENT_ARTIFACT_SCOPE_INVALID");
  }
  const root = realpathSync(workspace);
  if (git(root, "rev-parse", "--show-toplevel").replaceAll("\\", "/").toLowerCase() !==
      root.replaceAll("\\", "/").toLowerCase() ||
      !lstatSync(join(root, ".git")).isFile() ||
      git(root, "branch", "--show-current") !== "" ||
      git(root, "rev-parse", "HEAD") !== baseRevision) {
    throw Error("INDEPENDENT_ARTIFACT_WORKTREE_INVALID");
  }
  if (edits.length && git(root,"ls-files","-v","-z").split("\0").filter(Boolean).some(entry => !entry.startsWith("H "))) {
    throw Error("INDEPENDENT_ARTIFACT_INDEX_UNSAFE");
  }
  for (const edit of edits) {
    try { if (lstatSync(join(root,edit.path)).isSymbolicLink()) throw Error("INDEPENDENT_ARTIFACT_FILE_UNSAFE"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const observed = git(root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).sort();
  const expected = [...allowedUntracked.map(p => `?? ${p}`), ...edits.map(edit => ` M ${edit.path}`)].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw Error("INDEPENDENT_ARTIFACT_STATUS_MISMATCH");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const files = {};
  for (const path of paths) {
    let cursor = root;
    for (const part of path.split("/").slice(0, -1)) {
      cursor = join(cursor, part);
      const info = lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error("INDEPENDENT_ARTIFACT_PARENT_UNSAFE");
    }
    const file = resolve(root, path);
    if (!(file.startsWith(root + sep))) throw Error("INDEPENDENT_ARTIFACT_PATH_ESCAPE");
    const limit = edits.some(edit => edit.path === path) && path === "docs/jarvis-reverse-traceability.json" ? 1048576 : maxBytes;
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw Error("INDEPENDENT_ARTIFACT_FILE_UNSAFE");
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino)
        throw Error("INDEPENDENT_ARTIFACT_FILE_UNSAFE");
      const buffer = Buffer.alloc(limit + 1);
      let count = 0, read;
      while (count < buffer.length && (read = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += read;
      const after = fstatSync(fd);
      if (count > limit || count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
        throw Error("INDEPENDENT_ARTIFACT_CHANGED_DURING_READ");
      bytes = buffer.subarray(0, count);
    } finally { closeSync(fd); }
    const content = decoder.decode(bytes);
    if (!Buffer.from(content, "utf8").equals(bytes) || content.includes("\u0000")) throw Error("INDEPENDENT_ARTIFACT_NOT_PLAIN_UTF8");
    const edit = edits.find(edit => edit.path === path);
    if (edit) {
      const tree = git(root,"ls-tree","-z","HEAD","--",path).split("\0").filter(Boolean);
      const entry = tree.length === 1 ? /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/.exec(tree[0]) : null;
      if (!entry || entry[3] !== path) throw Error("INDEPENDENT_ARTIFACT_BASELINE_MISMATCH");
      const baseline = git(root,"cat-file","blob",entry[2]);
      if (baseline.length > limit || createHash("sha256").update(baseline).digest("hex") !== edit.beforeSha256)
        throw Error("INDEPENDENT_ARTIFACT_BASELINE_MISMATCH");
      if (process.platform !== "win32" && !!(info.mode & 0o111) !== (entry[1] === "100755"))
        throw Error("INDEPENDENT_ARTIFACT_MODE_MISMATCH");
      if (createHash("sha256").update(bytes).digest("hex") !== edit.afterSha256)
        throw Error("INDEPENDENT_ARTIFACT_CONTENT_MISMATCH");
    }
    files[path] = bytes;
  }
  const after = git(root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).sort();
  if (JSON.stringify(after) !== JSON.stringify(expected) || git(root, "rev-parse", "HEAD") !== baseRevision) {
    throw Error("INDEPENDENT_ARTIFACT_CHANGED_DURING_READ");
  }
  const identity = localCandidateIdentity(baseRevision, targetPath, files);
  if (edits.length) {
    const manifest = paths.sort().map(path => {
      const edit = edits.find(edit => edit.path === path);
      return [path,edit?.beforeSha256 ?? null,identity.fileHashes[path]];
    });
    identity.patchDigest = createHash("sha256").update(`tracked-edits-v2\0${JSON.stringify(manifest)}`).digest("hex");
    identity.candidateRevision = createHash("sha256").update(`candidate\0${baseRevision}\0${identity.patchDigest}`).digest("hex");
  }
  return {
    baseRevision, targetPath, allowedUntracked: [...allowedUntracked].sort(),
    ...identity, ...(edits.length ? {trackedEdits:{version:2,files:edits}} : {}),
    verifierKind: "independent-byte-readback", recordedAt: new Date().toISOString(),
  };
}
