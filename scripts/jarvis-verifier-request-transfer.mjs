#!/usr/bin/env node
/** Called only after authenticated delivery and owner-controlled digest pinning.
 * Prepares a fresh candidate mirror. Does not execute code, sign, connect, or grant authority.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateResidentVerifierRequest, MAX_VERIFIER_REQUEST_BYTES } from "../src/orchestrator/resident-verifier-request.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "../src/orchestrator/resident-runtime-files.ts";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";
import { validateVerifierRunRequest } from "./jarvis-independent-check-runner.mjs";
import { safeGit } from "./jarvis-verifier-safe-git.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
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
  validateResidentVerifierRequest(packet);
  const req = validateVerifierRunRequest({ ...packet.request, candidateWorkspace: local.candidateWorkspace,
    verifierWorkspace: local.verifierWorkspace, privateKeyFile: local.privateKeyFile, receiptFile: local.receiptFile, verifierId: local.verifierId,
    expiresAt: packet.expiresAt });
  const candidate = detachedRoot(req.candidateWorkspace, req.baseRevision), verifier = detachedRoot(req.verifierWorkspace, req.baseRevision);
  if (contains(candidate, verifier) || contains(verifier, candidate)) throw Error("VERIFIER_TRANSFER_WORKSPACE_OVERLAP");
  for (const path of [req.privateKeyFile, req.receiptFile, req.receiptFile + ".logs"]) assertExternalRuntimePath(path, [candidate, verifier]);
  if (resolve(req.privateKeyFile) === resolve(req.receiptFile)) throw Error("VERIFIER_TRANSFER_AUTHORITY_OVERLAP");
  if (safeGit(verifier, ["status", "--porcelain", "-uall"]) !== "") throw Error("VERIFIER_TRANSFER_VERIFIER_STATUS_INVALID");
  const expected = new Set(req.allowedUntracked.map(path => "?? " + path));
  if (safeGit(candidate, ["status", "--porcelain", "-uall"]).split("\n").filter(Boolean).some(line => !expected.has(line))) throw Error("VERIFIER_TRANSFER_CANDIDATE_STATUS_INVALID");
  // Validate all destinations and replay bytes before creating any file. No
  // mkdir/overwrite/cleanup of an existing worktree or its prior evidence.
  const files = packet.files.map(file => {
    const target = assertExternalRuntimePath(join(candidate, file.path), []);
    if (!contains(candidate, target) || !lstatSync(dirname(target)).isDirectory()) throw Error("VERIFIER_TRANSFER_PARENT_INVALID");
    const content = Buffer.from(file.contentBase64, "base64");
    if (existsSync(target) && !readBoundedRuntimeFile(target, 131072).equals(content)) throw Error("VERIFIER_TRANSFER_EXISTING_MISMATCH");
    return { target, content };
  });
  for (const { target, content } of files) {
    if (!existsSync(target)) writeFileSync(target, content, { flag: "wx", mode: 0o600 });
  }
  const attested = attestLocalCandidate({ workspace: candidate, baseRevision: req.baseRevision, targetPath: req.targetPath, allowedUntracked: req.allowedUntracked });
  if (attested.candidateRevision !== req.sourceRevision || attested.artifactDigest !== req.artifactDigest) throw Error("VERIFIER_TRANSFER_FINAL_MISMATCH");
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
