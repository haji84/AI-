import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Host-owned configuration/receipts, never a candidate-supplied authority path. */
export function assertExternalRuntimePath(file: string, workspaces: string[]): string {
  if (!isAbsolute(file)) throw Error("RESIDENT_AUTHORITY_PATH_INVALID");
  const absolute = resolve(file);
  for (let cursor = absolute;; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error("RESIDENT_AUTHORITY_PATH_ALIAS");
    if (dirname(cursor) === cursor) break;
  }
  for (const workspace of workspaces) {
    const diff = relative(resolve(workspace), absolute);
    if (!diff || (!isAbsolute(diff) && diff !== ".." && !diff.startsWith(".." + sep))) {
      throw Error("RESIDENT_AUTHORITY_INSIDE_CANDIDATE");
    }
  }
  return absolute;
}

export function readBoundedRuntimeFile(file: string, maxBytes: number, workspaces: string[] = []): Buffer {
  const absolute = assertExternalRuntimePath(file, workspaces);
  const observed = lstatSync(absolute);
  if (!observed.isFile() || observed.nlink !== 1 || observed.size < 1 || observed.size > maxBytes) throw Error("RESIDENT_AUTHORITY_FILE_INVALID");
  const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.ino !== observed.ino || before.dev !== observed.dev) throw Error("RESIDENT_AUTHORITY_FILE_CHANGED");
    const bytes = Buffer.alloc(maxBytes + 1); let count = 0, read: number;
    while (count < bytes.length && (read = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    const after = fstatSync(fd);
    if (count !== before.size || count > maxBytes || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw Error("RESIDENT_AUTHORITY_FILE_CHANGED");
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
