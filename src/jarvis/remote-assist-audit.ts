import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JarvisRemoteAssistAuditEvent } from "./remote-assist.ts";

const SENSITIVE_DETAIL_KEY = /(authorization|credential|password|secret|text|token|url)/i;

function sanitizeDetail(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = value.slice(0, 160);
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function sanitizeRemoteAssistAuditEvent(event: JarvisRemoteAssistAuditEvent): JarvisRemoteAssistAuditEvent {
  return {
    ...event,
    detail: sanitizeDetail(event.detail),
  };
}

export class JarvisRemoteAssistAuditStore {
  private readonly path: string;
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  constructor(
    path = resolve(process.cwd(), ".jarvis", "remote-assist-audit.jsonl"),
    maxEvents = 5_000,
    maxBytes = 5 * 1024 * 1024,
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) throw new Error("maxEvents must be positive");
    if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error("maxBytes must be at least 1024");
    this.path = path;
    this.maxEvents = maxEvents;
    this.maxBytes = maxBytes;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(event: JarvisRemoteAssistAuditEvent): void {
    const safe = sanitizeRemoteAssistAuditEvent(event);
    appendFileSync(this.path, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
    if (statSync(this.path).size > this.maxBytes) this.compact();
  }

  list(sessionId?: string, limit = 200): JarvisRemoteAssistAuditEvent[] {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    if (!existsSync(this.path)) return [];
    const events = readFileSync(this.path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as JarvisRemoteAssistAuditEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is JarvisRemoteAssistAuditEvent => Boolean(event))
      .filter((event) => !sessionId || event.sessionId === sessionId);
    return events.slice(-boundedLimit);
  }

  private compact(): void {
    if (!existsSync(this.path)) return;
    const lines = readFileSync(this.path, "utf8").split(/\r?\n/).filter(Boolean).slice(-this.maxEvents);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, lines.length ? `${lines.join("\n")}\n` : "", { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
