import { createHash } from "node:crypto";
import { lstat, mkdir, rmdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { PcLocalIdentity } from "./pc-local-identity.ts";

/** One host execution slot across local and private-peer clients, not distributed consensus. */
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
  const lock = join(root, "execution-lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch { throw new Error("PC_EXECUTION_BUSY"); }
  const owned = await lstat(lock);
  try { return await run(); }
  finally {
    const current = await lstat(lock);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino) {
      throw new Error("PC_EXECUTION_LOCK_REPLACED");
    }
    await rmdir(lock);
  }
}
