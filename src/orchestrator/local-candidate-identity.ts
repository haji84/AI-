import { createHash } from "node:crypto";

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

/** Bind the entire declared candidate, including supporting tests, to the base.
 * Single-file identities retain their existing format. Callers validate scope
 * and independently read bytes; this pure function is not verification evidence.
 */
export function localCandidateIdentity(baseRevision: string, targetPath: string, files: Record<string, string | Buffer>) {
  const paths = Object.keys(files).sort();
  if (!paths.length || !paths.includes(targetPath)) throw Error("LOCAL_CANDIDATE_TARGET_MISSING");
  const fileHashes = Object.fromEntries(paths.map(path => [path, sha256(files[path]!)]));
  const patchDigest = paths.length === 1
    ? sha256(`create\0${targetPath}\0${files[targetPath]!.toString()}`)
    : sha256(`create-set-v1\0${JSON.stringify(paths.map(path => [path, fileHashes[path]]))}`);
  return { fileHashes, artifactDigest: fileHashes[targetPath]!, patchDigest,
    candidateRevision: sha256(`candidate\0${baseRevision}\0${patchDigest}`) };
}
