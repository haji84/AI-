import { randomUUID } from "node:crypto";
import type { JarvisTakeoverSession } from "./types.ts";

export class JarvisHumanTakeoverManager {
  private readonly sessions = new Map<string, JarvisTakeoverSession>();

  request(input: Omit<JarvisTakeoverSession, "id" | "status" | "createdAt" | "updatedAt">, now = new Date()): JarvisTakeoverSession {
    const session: JarvisTakeoverSession = {
      id: randomUUID(),
      status: "requested",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...input,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  restore(sessions: JarvisTakeoverSession[]): void {
    this.sessions.clear();
    for (const session of sessions) this.sessions.set(session.id, structuredClone(session));
  }

  list(): JarvisTakeoverSession[] {
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }

  activate(sessionId: string, now = new Date()): JarvisTakeoverSession {
    return this.patch(sessionId, { status: "active", updatedAt: now.toISOString() });
  }

  resolve(sessionId: string, now = new Date()): JarvisTakeoverSession {
    return this.patch(sessionId, { status: "resolved", updatedAt: now.toISOString() });
  }

  cancel(sessionId: string, now = new Date()): JarvisTakeoverSession {
    return this.patch(sessionId, { status: "cancelled", updatedAt: now.toISOString() });
  }

  activeForNode(nodeId: string): JarvisTakeoverSession | undefined {
    const item = [...this.sessions.values()].find((session) => session.nodeId === nodeId && (session.status === "requested" || session.status === "active"));
    return item ? structuredClone(item) : undefined;
  }

  private patch(sessionId: string, patch: Partial<JarvisTakeoverSession>): JarvisTakeoverSession {
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error(`Unknown takeover session: ${sessionId}`);
    const updated = { ...current, ...patch };
    this.sessions.set(sessionId, updated);
    return structuredClone(updated);
  }
}
