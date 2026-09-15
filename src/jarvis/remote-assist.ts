import { randomUUID } from "node:crypto";

export type JarvisRemoteAssistCapability = "VIEW_ONLY" | "CONTROLLABLE" | "FULL_MANAGEMENT";
export type JarvisRemoteAssistSessionStatus = "active" | "ended" | "expired";

export interface JarvisRemoteAssistSession {
  id: string;
  serial: string;
  capability: JarvisRemoteAssistCapability;
  status: JarvisRemoteAssistSessionStatus;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  endedAt?: string;
}

export interface JarvisRemoteAssistAuditEvent {
  id: string;
  at: string;
  action: "session.created" | "session.touched" | "session.ended" | "session.expired";
  sessionId: string;
  serial: string;
  detail?: Record<string, unknown>;
}

export type JarvisManualRemoteAction = "screenshot" | "tap" | "swipe" | "text" | "keyevent" | "open-url";

const MANUAL_REMOTE_ACTIONS = new Set<JarvisManualRemoteAction>([
  "screenshot",
  "tap",
  "swipe",
  "text",
  "keyevent",
  "open-url",
]);

export function isManualRemoteAction(value: unknown): value is JarvisManualRemoteAction {
  return typeof value === "string" && MANUAL_REMOTE_ACTIONS.has(value as JarvisManualRemoteAction);
}

export function capabilityForRemoteDevice(input: {
  canView: boolean;
  canControl: boolean;
  fullManagement?: boolean;
}): JarvisRemoteAssistCapability | null {
  if (!input.canView) return null;
  if (input.fullManagement && input.canControl) return "FULL_MANAGEMENT";
  if (input.canControl) return "CONTROLLABLE";
  return "VIEW_ONLY";
}

export class JarvisRemoteAssistSessionManager {
  private readonly sessions = new Map<string, JarvisRemoteAssistSession>();
  private readonly auditEvents: JarvisRemoteAssistAuditEvent[] = [];

  constructor(
    private readonly defaultTtlMs = 10 * 60_000,
    private readonly maxTtlMs = 30 * 60_000,
    private readonly maxAuditEvents = 1_000,
  ) {
    if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) throw new Error("defaultTtlMs must be positive");
    if (!Number.isFinite(maxTtlMs) || maxTtlMs < defaultTtlMs) throw new Error("maxTtlMs must be >= defaultTtlMs");
    if (!Number.isInteger(maxAuditEvents) || maxAuditEvents <= 0) throw new Error("maxAuditEvents must be positive");
  }

  start(input: {
    serial: string;
    capability: JarvisRemoteAssistCapability;
    ttlMs?: number;
  }, now = new Date()): JarvisRemoteAssistSession {
    this.expireDue(now);
    const serial = input.serial.trim();
    if (!serial) throw new Error("Remote Assist serial is required");
    const ttlMs = this.normalizeTtl(input.ttlMs);
    const at = now.toISOString();
    const session: JarvisRemoteAssistSession = {
      id: randomUUID(),
      serial,
      capability: input.capability,
      status: "active",
      createdAt: at,
      lastActivityAt: at,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.sessions.set(session.id, session);
    this.audit("session.created", session, now, { capability: session.capability, ttlMs });
    return structuredClone(session);
  }

  requireActive(sessionId: string, serial: string, now = new Date()): JarvisRemoteAssistSession {
    this.expireDue(now);
    const current = this.sessions.get(sessionId);
    if (!current || current.status !== "active") throw new Error("Remote Assist session is not active");
    if (current.serial !== serial) throw new Error("Remote Assist session is bound to another device");
    return structuredClone(current);
  }

  touch(sessionId: string, serial: string, now = new Date()): JarvisRemoteAssistSession {
    this.requireActive(sessionId, serial, now);
    const original = this.sessions.get(sessionId)!;
    const ttlMs = Math.min(this.maxTtlMs, Math.max(1, new Date(original.expiresAt).getTime() - new Date(original.lastActivityAt).getTime()));
    const updated: JarvisRemoteAssistSession = {
      ...original,
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.sessions.set(sessionId, updated);
    this.audit("session.touched", updated, now);
    return structuredClone(updated);
  }

  end(sessionId: string, now = new Date()): JarvisRemoteAssistSession {
    this.expireDue(now);
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error("Unknown Remote Assist session");
    if (current.status !== "active") return structuredClone(current);
    const updated: JarvisRemoteAssistSession = {
      ...current,
      status: "ended",
      endedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
    };
    this.sessions.set(sessionId, updated);
    this.audit("session.ended", updated, now);
    return structuredClone(updated);
  }

  get(sessionId: string, now = new Date()): JarvisRemoteAssistSession | undefined {
    this.expireDue(now);
    const current = this.sessions.get(sessionId);
    return current ? structuredClone(current) : undefined;
  }

  auditFor(sessionId?: string): JarvisRemoteAssistAuditEvent[] {
    return this.auditEvents
      .filter((event) => !sessionId || event.sessionId === sessionId)
      .map((event) => structuredClone(event));
  }

  private normalizeTtl(requested?: number): number {
    if (requested === undefined) return this.defaultTtlMs;
    if (!Number.isInteger(requested) || requested <= 0) throw new Error("Remote Assist ttlMs must be a positive integer");
    return Math.min(requested, this.maxTtlMs);
  }

  private expireDue(now: Date): void {
    const nowMs = now.getTime();
    for (const [id, session] of this.sessions) {
      if (session.status !== "active" || new Date(session.expiresAt).getTime() > nowMs) continue;
      const expired: JarvisRemoteAssistSession = {
        ...session,
        status: "expired",
        lastActivityAt: now.toISOString(),
      };
      this.sessions.set(id, expired);
      this.audit("session.expired", expired, now);
    }
  }

  private audit(
    action: JarvisRemoteAssistAuditEvent["action"],
    session: JarvisRemoteAssistSession,
    now: Date,
    detail?: Record<string, unknown>,
  ): void {
    this.auditEvents.push({
      id: randomUUID(),
      at: now.toISOString(),
      action,
      sessionId: session.id,
      serial: session.serial,
      detail,
    });
    if (this.auditEvents.length > this.maxAuditEvents) {
      this.auditEvents.splice(0, this.auditEvents.length - this.maxAuditEvents);
    }
  }
}
