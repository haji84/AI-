import { randomUUID } from "node:crypto";

export interface TaskCompletionAuthorization {
  kind: "task_completion";
  scopeId: string;
  allowLowMediumMainMerge: true;
  issuedBy: "owner";
  issuedAt: string;
  expiresAt: string;
}

const COMPLETION_PATTERNS = [
  /最後まで.{0,12}(進め|やって|任せ)/u,
  /完了まで.{0,12}(進め|やって|任せ)/u,
  /全部.{0,12}(進め|やって|任せ)/u,
  /任せる/u,
  /finish\s+(it|this|the\s+task)/i,
  /take\s+it\s+to\s+completion/i,
  /handle.{0,20}(through|to)\s+(the\s+)?end/i,
];

function issueScope(command: string): string | null {
  const match = command.match(/(?:Issue\s*)?#(\d+)/i);
  return match ? `issue:${match[1]}` : null;
}

export function requestsTaskCompletion(command: string): boolean {
  const normalized = command.trim();
  return normalized.length > 0 && COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function createTaskCompletionAuthorization(
  command: string,
  options: { now?: Date; ttlHours?: number; idFactory?: () => string } = {},
): TaskCompletionAuthorization | undefined {
  if (!requestsTaskCompletion(command)) return undefined;

  const now = options.now ?? new Date();
  const ttlHours = options.ttlHours ?? 24 * 7;
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const scopeId = issueScope(command) ?? `command:${(options.idFactory ?? randomUUID)()}`;

  return {
    kind: "task_completion",
    scopeId,
    allowLowMediumMainMerge: true,
    issuedBy: "owner",
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function normalizeTaskCompletionAuthorization(value: unknown): TaskCompletionAuthorization {
  if (!value || typeof value !== "object") throw new Error("Task completion authorization is invalid");
  const auth = value as Partial<TaskCompletionAuthorization>;
  if (auth.kind !== "task_completion"
    || typeof auth.scopeId !== "string"
    || !auth.scopeId.trim()
    || auth.allowLowMediumMainMerge !== true
    || auth.issuedBy !== "owner"
    || typeof auth.issuedAt !== "string"
    || Number.isNaN(Date.parse(auth.issuedAt))
    || typeof auth.expiresAt !== "string"
    || Number.isNaN(Date.parse(auth.expiresAt))) {
    throw new Error("Task completion authorization is invalid");
  }
  return {
    kind: "task_completion",
    scopeId: auth.scopeId.trim(),
    allowLowMediumMainMerge: true,
    issuedBy: "owner",
    issuedAt: auth.issuedAt,
    expiresAt: auth.expiresAt,
  };
}

export function isTaskCompletionAuthorizationActive(
  authorization: TaskCompletionAuthorization | undefined,
  scopeId: string | undefined,
  now = new Date(),
): boolean {
  if (!authorization || !scopeId) return false;
  if (authorization.scopeId !== scopeId) return false;
  return authorization.allowLowMediumMainMerge === true
    && authorization.issuedBy === "owner"
    && Date.parse(authorization.issuedAt) <= now.getTime()
    && Date.parse(authorization.expiresAt) > now.getTime();
}
