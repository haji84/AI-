import { createHash } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PcLocalIdentity } from "./pc-local-identity.ts";

/** One host slot across clients. SQLite's OS lock releases on process death;
 * this separate empty lock file is not a task/state database or peer consensus. */
export async function withPcExecutionLock<T>(identity: PcLocalIdentity, run: () => Promise<T>): Promise<T> {
  const root = process.platform === "win32"
    ? join(process.env.USERPROFILE || homedir(), "JARVIS", "production", "pc-node", identity.nodeId)
    : process.platform === "darwin" ? join(homedir(), ".goriq", "state", "pc-node", identity.nodeId)
    : join(tmpdir(), "goriq-pc-executor-" + createHash("sha256").update(identity.publicKeyPem).digest("hex"));
  if (process.platform !== "win32" && process.platform !== "darwin") await mkdir(root, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const parent = await lstat(root);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== "win32" &&
    (parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0))) throw new Error("PC_EXECUTION_BOUNDARY_REJECTED");
  const lock = join(root, "execution-lock.sqlite");
  try { const created = await open(lock, "wx", 0o600); await created.close(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const file = await lstat(lock);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (process.platform !== "win32" &&
    (file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0))) throw new Error("PC_EXECUTION_BOUNDARY_REJECTED");
  const db = new DatabaseSync(lock);
  try {
    try { db.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); }
    catch { throw new Error("PC_EXECUTION_BUSY"); }
    // No schema, table, task or user data is written to this coordination file.
    return await run();
  } finally { db.close(); }
}
