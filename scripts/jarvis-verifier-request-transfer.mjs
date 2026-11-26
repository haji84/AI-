#!/usr/bin/env node
/** Called only after authenticated delivery and owner-controlled digest pinning.
 * Prepares a fresh candidate mirror. Does not execute code, sign, connect, or grant authority.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateResidentVerifierRequest, MAX_VERIFIER_REQUEST_BYTES } from "../src/orchestrator/resident-verifier-request.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "../src/orchestrator/resident-runtime-files.ts";
import { attestLocalCandidate, validateTrackedEditsManifest } from "./jarvis-independent-artifact-attestation.mjs";
import { validateVerifierRunRequest } from "./jarvis-independent-check-runner.mjs";
import { safeGit } from "./jarvis-verifier-safe-git.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys;
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const bookkeeping = "docs/jarvis-reverse-traceability.json";
const fileLimit = path => path === bookkeeping ? 1048576 : 131072;

/** Accept only the packet emitted by the existing tracked-repair runtime.
 * The authenticated digest pin remains host-owned; packet data grants no authority. */
function validateTrackedTransferPacket(packet) {
  if (!exact(packet, "executionContractDigest,expiresAt,files,kind,request,version") || packet.version !== 2
    || packet.kind !== "tracked-repair-verifier-request" || !digest(packet.executionContractDigest)
    || typeof packet.expiresAt !== "string" || !Number.isFinite(Date.parse(packet.expiresAt))
    || new Date(packet.expiresAt).toISOString() !== packet.expiresAt || Date.parse(packet.expiresAt) <= Date.now()) throw Error("VERIFIER_REQUEST_SCOPE_INVALID");
  const req = packet.request;
  if (!exact(req, "allowedUntracked,artifactDigest,baseRevision,builderId,changeSetId,goalId,jobId,requiredChecks,sourceRevision,targetPath,trackedEdits")
    || ![req.goalId, req.jobId, req.changeSetId, req.builderId].every(id => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(id))
    || !/^[a-f0-9]{40}$/.test(req.baseRevision) || !digest(req.sourceRevision) || !digest(req.artifactDigest)
    || !Array.isArray(req.allowedUntracked) || req.allowedUntracked.length !== 1
    || !/^tests\/[A-Za-z0-9_/-]+\.test\.(mjs|ts)$/.test(req.allowedUntracked[0])) throw Error("VERIFIER_REQUEST_BINDING_INVALID");
  const edits = validateTrackedEditsManifest(req.trackedEdits);
  const source = path => typeof path === "string" && /^(src|scripts)\/[A-Za-z0-9_./-]+$/.test(path)
    && !path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
  if (!edits.length || edits.length > 9 || edits.filter(edit => source(edit.path)).length > 8
    || edits.some(edit => !source(edit.path) && edit.path !== bookkeeping)
    || !source(req.targetPath) || !edits.some(edit => edit.path === req.targetPath)) throw Error("VERIFIER_REQUEST_BINDING_INVALID");
  const paths = [...edits.map(edit => edit.path), ...req.allowedUntracked].sort();
  if (new Set(paths).size !== paths.length || !Array.isArray(packet.files) || packet.files.length !== paths.length) throw Error("VERIFIER_REQUEST_FILES_INVALID");
  const files = new Map();
  for (const file of packet.files) {
    if (!exact(file, "contentBase64,path,sha256") || !paths.includes(file.path) || files.has(file.path) || !digest(file.sha256)
      || typeof file.contentBase64 !== "string" || file.contentBase64.length > Math.ceil(fileLimit(file.path) / 3) * 4) throw Error("VERIFIER_REQUEST_FILES_INVALID");
    const bytes = Buffer.from(file.contentBase64, "base64"), text = bytes.toString("utf8"), edit = edits.find(edit => edit.path === file.path);
    if (!bytes.length || bytes.length > fileLimit(file.path) || bytes.toString("base64") !== file.contentBase64
      || !Buffer.from(text).equals(bytes) || text.includes("\0") || hash(bytes) !== file.sha256
      || edit && edit.afterSha256 !== file.sha256) throw Error("VERIFIER_REQUEST_FILE_DIGEST_MISMATCH");
    files.set(file.path, file.sha256);
  }
  const manifest = paths.map(path => [path, edits.find(edit => edit.path === path)?.beforeSha256 ?? null, files.get(path)]);
  const candidateRevision = hash(`candidate\0${req.baseRevision}\0${hash(`tracked-edits-v2\0${JSON.stringify(manifest)}`)}`);
  if (candidateRevision !== req.sourceRevision || files.get(req.targetPath) !== req.artifactDigest) throw Error("VERIFIER_REQUEST_CANDIDATE_MISMATCH");
  return edits;
}
function detachedRoot(path, base) {
  assertExternalRuntimePath(path, []);
  const root = realpathSync(path), git = (...args) => safeGit(root, args);
  if (!lstatSync(join(root, ".git")).isFile() || git("branch", "--show-current") !== ""
    || git("rev-parse", "HEAD") !== base || git("rev-parse", "--show-toplevel").replaceAll("\\", "/").toLowerCase() !== root.replaceAll("\\", "/").toLowerCase()) {
    throw Error("VERIFIER_TRANSFER_WORKTREE_INVALID");
  }
  return root;
}
const contains = (parent, child) => { const p = relative(parent, child); return !p || (!isAbsolute(p) && p !== ".." && !p.startsWith(".." + sep)); };

export function prepareTransferredVerifierRequest(bytes, local) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_VERIFIER_REQUEST_BYTES
    || !/^[a-f0-9]{64}$/.test(local?.expectedRequestSha256 ?? "") || hash(bytes) !== local.expectedRequestSha256) throw Error("VERIFIER_TRANSFER_PIN_MISMATCH");
  const packet = JSON.parse(bytes.toString("utf8"));
  const edits = packet?.version === 2 ? validateTrackedTransferPacket(packet) : (validateResidentVerifierRequest(packet), []);
  const req = validateVerifierRunRequest({ ...packet.request, candidateWorkspace: local.candidateWorkspace,
    verifierWorkspace: local.verifierWorkspace, privateKeyFile: local.privateKeyFile, receiptFile: local.receiptFile, verifierId: local.verifierId,
    expiresAt: packet.expiresAt });
  const candidate = detachedRoot(req.candidateWorkspace, req.baseRevision), verifier = detachedRoot(req.verifierWorkspace, req.baseRevision);
  if (contains(candidate, verifier) || contains(verifier, candidate)) throw Error("VERIFIER_TRANSFER_WORKSPACE_OVERLAP");
  for (const path of [req.privateKeyFile, req.receiptFile, req.receiptFile + ".logs"]) assertExternalRuntimePath(path, [candidate, verifier]);
  if (resolve(req.privateKeyFile) === resolve(req.receiptFile)) throw Error("VERIFIER_TRANSFER_AUTHORITY_OVERLAP");
  if (safeGit(verifier, ["status", "--porcelain", "-uall"]) !== "") throw Error("VERIFIER_TRANSFER_VERIFIER_STATUS_INVALID");
  if (edits.length && [candidate, verifier].some(root => safeGit(root, ["ls-files", "-v", "-z"]).split("\0").filter(Boolean).some(entry => !entry.startsWith("H ")))) {
    throw Error("VERIFIER_TRANSFER_INDEX_UNSAFE");
  }
  const expected = new Set([...req.allowedUntracked.map(path => "?? " + path), ...edits.map(edit => " M " + edit.path)]);
  if (safeGit(candidate, ["status", "--porcelain", "-uall"]).split("\n").filter(Boolean).some(line => !expected.has(line))) throw Error("VERIFIER_TRANSFER_CANDIDATE_STATUS_INVALID");
  // Validate all destinations and replay bytes before creating any file. No
  // mkdir/cleanup. Only an explicitly pinned original tracked file can be
  // overwritten; different earlier candidate bytes must remain untouched.
  const files = packet.files.map(file => {
    const target = assertExternalRuntimePath(join(candidate, file.path), []);
    if (!contains(candidate, target) || !lstatSync(dirname(target)).isDirectory()) throw Error("VERIFIER_TRANSFER_PARENT_INVALID");
    const content = Buffer.from(file.contentBase64, "base64");
    const edit = edits.find(edit => edit.path === file.path);
    if (edit) {
      const tree = safeGit(candidate, ["ls-tree", "-z", "HEAD", "--", file.path]).split("\0").filter(Boolean);
      const entry = tree.length === 1 ? /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/.exec(tree[0]) : null;
      if (!entry || entry[3] !== file.path || hash(safeGit(candidate, ["cat-file", "blob", entry[2]])) !== edit.beforeSha256) throw Error("VERIFIER_TRANSFER_BASELINE_MISMATCH");
      const original = readBoundedRuntimeFile(target, fileLimit(file.path)), observed = lstatSync(target);
      if (process.platform !== "win32" && !!(observed.mode & 0o111) !== (entry[1] === "100755")) throw Error("VERIFIER_TRANSFER_TARGET_UNSAFE");
      if (!original.equals(content) && hash(original) !== edit.beforeSha256) throw Error("VERIFIER_TRANSFER_EXISTING_MISMATCH");
      return { target, content, observed, replace: !original.equals(content) };
    }
    if (existsSync(target) && !readBoundedRuntimeFile(target, 131072).equals(content)) throw Error("VERIFIER_TRANSFER_EXISTING_MISMATCH");
    return { target, content, replace: false };
  });
  validateVerifierRunRequest(req); // preflight cannot extend the fixed approval deadline
  for (const { target, content, observed, replace } of files) {
    if (replace) {
      const fd = openSync(target, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== observed.dev || opened.ino !== observed.ino
          || opened.size !== observed.size || opened.mtimeMs !== observed.mtimeMs) throw Error("VERIFIER_TRANSFER_TARGET_CHANGED");
        writeFileSync(fd, content); ftruncateSync(fd, content.length);
      } finally { closeSync(fd); }
    } else if (!existsSync(target)) writeFileSync(target, content, { flag: "wx", mode: 0o600 });
  }
  const attested = attestLocalCandidate({ workspace: candidate, baseRevision: req.baseRevision, targetPath: req.targetPath,
    allowedUntracked: req.allowedUntracked, trackedEdits: req.trackedEdits });
  if (attested.candidateRevision !== req.sourceRevision || attested.artifactDigest !== req.artifactDigest) throw Error("VERIFIER_TRANSFER_FINAL_MISMATCH");
  validateVerifierRunRequest(req);
  return { ...req, candidateWorkspace: candidate, verifierWorkspace: verifier };
}

if (process.argv[1] && basename(process.argv[1]) === "jarvis-verifier-request-transfer.mjs") {
  try {
    if (process.argv.length !== 4 || !isAbsolute(process.argv[2]) || !isAbsolute(process.argv[3])) throw Error("VERIFIER_TRANSFER_INPUT_PATHS_REQUIRED");
    const bytes = readBoundedRuntimeFile(process.argv[2], MAX_VERIFIER_REQUEST_BYTES);
    const local = JSON.parse(readBoundedRuntimeFile(process.argv[3], 16384).toString("utf8"));
    process.stdout.write(JSON.stringify(prepareTransferredVerifierRequest(bytes, local)) + "\n");
  } catch (error) { process.stderr.write("VERIFIER_TRANSFER_STOP:" + String(error.message).slice(0, 180) + "\n"); process.exitCode = 1; }
}
