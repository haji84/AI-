/** Generic read-only, independent-process artifact attestation primitive.
 * The caller must run this module in a separately launched verifier process.
 * It checks bytes and Git state. It NEVER certifies executable behavior,
 * repository checks, OS isolation, reviewer independence or release readiness.
 */
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

export function attestLocalCandidate({ workspace, baseRevision, targetPath, allowedUntracked, maxBytes = 131072 }) {
  if (typeof workspace !== "string" || !isAbsolute(workspace) ||
      !/^[0-9a-f]{40}$/.test(baseRevision) ||
      !safeRelative(targetPath) ||
      !Array.isArray(allowedUntracked) || allowedUntracked.length < 1 ||
      allowedUntracked.length > 32 || allowedUntracked.some(p => !safeRelative(p)) ||
      new Set(allowedUntracked).size !== allowedUntracked.length ||
      !allowedUntracked.includes(targetPath) ||
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
  const observed = git(root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).sort();
  const expected = allowedUntracked.map(p => `?? ${p}`).sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw Error("INDEPENDENT_ARTIFACT_STATUS_MISMATCH");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const files = {};
  for (const path of allowedUntracked) {
    let cursor = root;
    for (const part of path.split("/").slice(0, -1)) {
      cursor = join(cursor, part);
      const info = lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error("INDEPENDENT_ARTIFACT_PARENT_UNSAFE");
    }
    const file = resolve(root, path);
    if (!(file.startsWith(root + sep))) throw Error("INDEPENDENT_ARTIFACT_PATH_ESCAPE");
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw Error("INDEPENDENT_ARTIFACT_FILE_UNSAFE");
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino)
        throw Error("INDEPENDENT_ARTIFACT_FILE_UNSAFE");
      const buffer = Buffer.alloc(maxBytes + 1);
      let count = 0, read;
      while (count < buffer.length && (read = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += read;
      const after = fstatSync(fd);
      if (count > maxBytes || count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
        throw Error("INDEPENDENT_ARTIFACT_CHANGED_DURING_READ");
      bytes = buffer.subarray(0, count);
    } finally { closeSync(fd); }
    const content = decoder.decode(bytes);
    if (!Buffer.from(content, "utf8").equals(bytes) || content.includes("\u0000")) throw Error("INDEPENDENT_ARTIFACT_NOT_PLAIN_UTF8");
    files[path] = bytes;
  }
  const after = git(root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).sort();
  if (JSON.stringify(after) !== JSON.stringify(expected) || git(root, "rev-parse", "HEAD") !== baseRevision) {
    throw Error("INDEPENDENT_ARTIFACT_CHANGED_DURING_READ");
  }
  return {
    baseRevision, targetPath, allowedUntracked: [...allowedUntracked].sort(),
    ...localCandidateIdentity(baseRevision, targetPath, files),
    verifierKind: "independent-byte-readback", recordedAt: new Date().toISOString(),
  };
}
