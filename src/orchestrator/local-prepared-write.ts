import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";

export interface PreparedLocalWriteBinding {
  executionContractDigest: string;
  goalId: string;
  jobId: string;
  workItemId: string;
  attemptId: string;
  strategyId: string;
  phase: "red" | "green";
  baseRevision: string;
  workspace: string;
  path: string;
  model: string;
}
interface PreparedRecord {
  version: 1;
  kind: "local-prepared-write:v1";
  verified: false;
  binding: PreparedLocalWriteBinding;
  content: string;
  contentSha256: string;
  preparedAt: string;
}
export interface PreparedLocalWriteCheckpoint {
  readonly binding: Readonly<PreparedLocalWriteBinding>;
  load(): string | null;
  prepare(content: string): void;
}
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

/** Trusted host option only. These public fixture bytes are recovery intent,
 * never verified evidence or authority to execute a Goal/modify another path.
 * The single host writer and existing runtime-directory ownership are required.
 */
export function createPreparedLocalWriteCheckpoint(input: {
  stateRoot: string; workspaces: string[]; binding: PreparedLocalWriteBinding;
}): PreparedLocalWriteCheckpoint {
  const binding = Object.freeze(structuredClone(input.binding));
  if (!/^[a-f0-9]{64}$/.test(binding.executionContractDigest) || !/^[a-f0-9]{40}$/.test(binding.baseRevision)
    || !["red", "green"].includes(binding.phase) || !input.workspaces.includes(binding.workspace)
    || Object.values(binding).some(value => typeof value !== "string" || !value || value.length > 4096)) throw Error("PREPARED_WRITE_BINDING_INVALID");
  const directory = assertExternalRuntimePath(join(input.stateRoot, "prepared-writes"), input.workspaces);
  const file = join(directory, `${hash(JSON.stringify(binding))}.json`);
  const load = (): string | null => {
    assertExternalRuntimePath(file, input.workspaces);
    if (!existsSync(file)) return null;
    const record = JSON.parse(readBoundedRuntimeFile(file, 32768, input.workspaces).toString("utf8")) as PreparedRecord;
    if (Object.keys(record).sort().join(",") !== "binding,content,contentSha256,kind,preparedAt,verified,version"
      || record.version !== 1 || record.kind !== "local-prepared-write:v1" || record.verified !== false
      || JSON.stringify(record.binding) !== JSON.stringify(binding) || typeof record.content !== "string"
      || !record.content || Buffer.byteLength(record.content) > 8192 || record.contentSha256 !== hash(record.content)
      || !Number.isFinite(Date.parse(record.preparedAt))) throw Error("PREPARED_WRITE_RECORD_INVALID");
    return record.content;
  };
  return { binding, load, prepare(content) {
    if (typeof content !== "string" || !content || Buffer.byteLength(content) > 8192) throw Error("PREPARED_WRITE_CONTENT_INVALID");
    assertExternalRuntimePath(file, input.workspaces);
    mkdirSync(directory, { recursive: true });
    assertExternalRuntimePath(file, input.workspaces);
    const record: PreparedRecord = { version: 1, kind: "local-prepared-write:v1", verified: false, binding,
      content, contentSha256: hash(content), preparedAt: new Date().toISOString() };
    const encoded = JSON.stringify(record) + "\n";
    if (Buffer.byteLength(encoded) > 32768) throw Error("PREPARED_WRITE_RECORD_BOUND");
    const fd = openSync(file, "wx", 0o600);
    try { writeFileSync(fd, encoded, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    // POSIX supports directory fsync. Windows fsync above flushes the file;
    // neither this journal nor source tests claim physical power-loss durability.
    if (process.platform !== "win32") {
      const parent = openSync(dirname(resolve(file)), "r");
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
  } };
}
