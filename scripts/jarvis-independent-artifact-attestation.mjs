/** Generic read-only, independent-process artifact attestation primitive.
 * The caller must run this module in a separately launched verifier process.
 * It checks bytes and Git state. It NEVER certifies executable behavior,
 * repository checks, OS isolation, reviewer independence or release readiness.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const hex = value => createHash("sha256").update(value).digest("hex");
const git = (root, ...args) => execFileSync("git", args,
  { cwd: root, encoding: "utf8", timeout: 8000, windowsHide: true }).trim();

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
  const hashes = {};
  let targetContent = null;
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
    const bytes = readFileSync(file);
    const content = decoder.decode(bytes);
    if (!Buffer.from(content, "utf8").equals(bytes) || content.includes("\u0000")) throw Error("INDEPENDENT_ARTIFACT_NOT_PLAIN_UTF8");
    hashes[path] = hex(bytes);
    if (path === targetPath) targetContent = content;
  }
  const after = git(root, "status", "--porcelain", "-uall").split("\n").filter(Boolean).sort();
  if (JSON.stringify(after) !== JSON.stringify(expected) || git(root, "rev-parse", "HEAD") !== baseRevision) {
    throw Error("INDEPENDENT_ARTIFACT_CHANGED_DURING_READ");
  }
  const artifactDigest = hashes[targetPath];
  const patchDigest = hex(`create\0${targetPath}\0${targetContent}`);
  const candidateRevision = hex(`candidate\0${baseRevision}\0${patchDigest}`);
  return {
    baseRevision, targetPath, allowedUntracked: [...allowedUntracked].sort(),
    fileHashes: hashes, artifactDigest, patchDigest, candidateRevision,
    verifierKind: "independent-byte-readback", recordedAt: new Date().toISOString(),
  };
}
