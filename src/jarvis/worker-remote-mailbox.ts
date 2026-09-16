import { randomUUID } from "node:crypto";

export function validateWorkerRemoteAction(input: Record<string, unknown>): Record<string, unknown> {
  const action = input.action;
  const coordinate = (name: string) => {
    const value = input[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 16_384) throw new Error("Invalid coordinate");
    return value;
  };
  if (action === "screenshot") return { action };
  if (action === "tap") return { action, x: coordinate("x"), y: coordinate("y") };
  if (action === "swipe") return { action, x1: coordinate("x1"), y1: coordinate("y1"), x2: coordinate("x2"), y2: coordinate("y2"), durationMs: 350 };
  if (action === "text" && typeof input.text === "string" && input.text.length > 0 && input.text.length <= 2_000) return { action, text: input.text };
  if (action === "keyevent" && ["KEYCODE_BACK", "KEYCODE_HOME", "KEYCODE_APP_SWITCH", "BACK", "HOME", "APP_SWITCH"].includes(String(input.key))) return { action, key: input.key };
  throw new Error("Unsupported Worker remote action");
}

type Command = { id: string; nodeId: string; sessionId: string; expiresAt: number; input: Record<string, unknown> };
type Entry = { command: Command; claimed: boolean; resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Ephemeral, one-shot commands: never retry input after reconnect/restart.
 * Only the authenticated Broker routes may enqueue, claim or finish. */
export class WorkerRemoteMailbox {
  private entries = new Map<string, Entry>();
  pending(nodeId: string) { return this.entries.has(nodeId); }
  request(nodeId: string, sessionId: string, input: Record<string, unknown>, expiresAt: number, signal?: AbortSignal) {
    if (!nodeId || !sessionId || this.entries.has(nodeId)) throw new Error("Device busy or invalid session");
    const ttl = Math.min(8_000, expiresAt - Date.now());
    if (ttl <= 0 || signal?.aborted) throw new Error("Remote command expired");
    const command: Command = { id: randomUUID(), nodeId, sessionId, expiresAt: Date.now() + ttl, input: validateWorkerRemoteAction(input) };
    const abort = () => this.cancel(nodeId, command.id);
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(abort, ttl);
      this.entries.set(nodeId, { command, claimed: false, resolve, reject, timer });
      signal?.addEventListener("abort", abort, { once: true });
    });
    return promise.finally(() => signal?.removeEventListener("abort", abort));
  }
  claim(nodeId: string): Command | null {
    const entry = this.entries.get(nodeId);
    if (!entry || entry.claimed || entry.command.expiresAt <= Date.now()) return null;
    entry.claimed = true;
    return entry.command;
  }
  finish(nodeId: string, id: string, result: Record<string, unknown>) {
    const entry = this.entries.get(nodeId);
    if (!entry || !entry.claimed || entry.command.id !== id || entry.command.expiresAt <= Date.now()) throw new Error("Unknown or expired remote command");
    this.entries.delete(nodeId); clearTimeout(entry.timer); entry.resolve(result);
  }
  cancel(nodeId: string, id: string) {
    const entry = this.entries.get(nodeId);
    if (!entry || entry.command.id !== id) return;
    this.entries.delete(nodeId); clearTimeout(entry.timer); entry.reject(new Error("Remote command ended without confirmation; input was not retried"));
  }
  endSession(sessionId: string) {
    for (const [nodeId, entry] of this.entries) if (entry.command.sessionId === sessionId) this.cancel(nodeId, entry.command.id);
  }
}
