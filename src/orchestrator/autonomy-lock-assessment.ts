import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type LockAssessment = "missing" | "active_or_reused_pid" | "foreign_host" | "stale_candidate" | "unknown";
export function assessAutonomyLock(lockDir: string): LockAssessment {
  let owner: unknown;
  try { owner = JSON.parse(readFileSync(resolve(lockDir, "owner.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unknown";
    return "unknown";
  }
  if (!owner || typeof owner !== "object") return "unknown";
  const value = owner as Record<string, unknown>;
  if (typeof value.host !== "string" || value.host !== hostname()) return "foreign_host";
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) < 1 || typeof value.startedAt !== "string") return "unknown";
  try {
    process.kill(value.pid as number, 0);
    return "active_or_reused_pid";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "stale_candidate";
    return "unknown";
  }
}
// A stale candidate is diagnostic only: never delete a lock solely on a PID probe.
// Recovery requires a fenced owner lease and reconciliation of durable work state.
