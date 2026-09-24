import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { open, unlink, link } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

interface Owner { version: 1; host: string; pid: number; nonce: string }
const localHost = hostname();
function owner(raw: string): Owner | null {
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && typeof value.host === "string" && Number.isSafeInteger(value.pid) && value.pid > 0 &&
      typeof value.nonce === "string" && /^[a-f0-9-]{36}$/.test(value.nonce) ? value : null;
  } catch { return null; }
}
function deadLocalOwner(value: Owner): boolean {
  if (value.host !== localHost) return false;
  try { process.kill(value.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
async function current(path: string): Promise<string | null> {
  try { const h = await open(path, "r"); try { if ((await h.stat()).size > 512) return ""; return await h.readFile("utf8"); } finally { await h.close(); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function unavailable(): Error { return Object.assign(new Error("EEXIST: cognitive writer lock unavailable; live, foreign or unknown owner requires reconciliation"), { code: "EEXIST" }); }
/** Local filesystem only. Native SQLite locking serializes recovery and is released by the OS on process exit.
 * No tables/schema are created. Identified metadata preserves fail-closed handling of old/foreign writers.
 * A synced unique file is linked atomically, so a crash cannot publish an anonymous/empty lock.
 */
export async function acquireCognitiveLease(path: string, waitMs = 0): Promise<() => Promise<void>> {
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 2000) throw Error("Invalid lease wait bound");
  const deadline = Date.now() + waitMs;
  const value: Owner = { version: 1, host: localHost, pid: process.pid, nonce: randomUUID() };
  const encoded = JSON.stringify(value);
  for (;;) {
    const arbiter = new DatabaseSync(path + ".arbiter.sqlite");
    let acquired = false;
    let temporary: string | undefined;
    try {
      arbiter.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
      const raw = await current(path);
      if (raw !== null) {
        const previous = owner(raw);
        if (!previous || !deadLocalOwner(previous)) throw unavailable();
        // Every current writer holds the same native lock; legacy live owners are never removed.
        await unlink(path);
      }
      temporary = path + "." + value.nonce + ".tmp";
      const handle = await open(temporary, "wx");
      try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      await link(temporary, path);
      await unlink(temporary); temporary = undefined;
      acquired = true;
      let released = false;
      return async () => {
        if (released) return;
        try {
          if (await current(path) !== encoded) throw Error("Cognitive lease owner changed; refusing release");
          await unlink(path);
        } finally { released = true; arbiter.close(); }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const busy = code === "EEXIST" || (code === "ERR_SQLITE_ERROR" && /(?:locked|busy)/i.test((error as Error).message));
      if (!busy) throw error;
      if (Date.now() >= deadline) throw unavailable();
    } finally {
      if (!acquired) arbiter.close();
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
