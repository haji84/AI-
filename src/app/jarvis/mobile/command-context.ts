export type CommandSource = "text" | "voice";
export type CommandOutcome = "sent" | "blocked" | "unsupported" | "failed";

export type SharedCommandHistoryEntry = {
  id: string;
  source: CommandSource;
  command: string;
  outcome: CommandOutcome;
  targetNodeId?: string;
  detail?: string;
  createdAt: string;
};

export type SharedCommandContext = {
  version: 1;
  targetNodeId?: string;
  selectedHistoryId?: string;
  history: SharedCommandHistoryEntry[];
};

export const SHARED_COMMAND_CONTEXT_KEY = "jarvis.mobile.command-context.v1";
export const MAX_SHARED_COMMAND_HISTORY = 12;
const MAX_STORED_TEXT = 180;
const SENSITIVE_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|password|passwd|api[_-]?key|authorization)$/i;

export function emptySharedCommandContext(): SharedCommandContext {
  return { version: 1, history: [] };
}

export function redactCommandContextText(value: string): string {
  let text = value.trim().replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  text = text.replace(/\b(token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*([^\s&,]+)/gi, "$1=[REDACTED]");
  text = text.replace(/https:\/\/[^\s]+/gi, (raw) => {
    try {
      const url = new URL(raw);
      if (url.username || url.password) {
        url.username = "";
        url.password = "";
      }
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
      }
      return url.toString();
    } catch {
      return raw.replace(/([?&](?:access[_-]?token|refresh[_-]?token|token|secret|password|passwd|api[_-]?key|authorization)=)[^&#\s]+/gi, "$1[REDACTED]");
    }
  });
  return text.slice(0, MAX_STORED_TEXT);
}

function isOutcome(value: unknown): value is CommandOutcome {
  return value === "sent" || value === "blocked" || value === "unsupported" || value === "failed";
}

function isSource(value: unknown): value is CommandSource {
  return value === "text" || value === "voice";
}

export function normalizeSharedCommandContext(value: unknown): SharedCommandContext {
  if (!value || typeof value !== "object") return emptySharedCommandContext();
  const candidate = value as { targetNodeId?: unknown; selectedHistoryId?: unknown; history?: unknown };
  const targetNodeId = typeof candidate.targetNodeId === "string" && candidate.targetNodeId.length <= 128
    ? candidate.targetNodeId
    : undefined;
  const history = Array.isArray(candidate.history)
    ? candidate.history.flatMap((item): SharedCommandHistoryEntry[] => {
        if (!item || typeof item !== "object") return [];
        const entry = item as Partial<SharedCommandHistoryEntry>;
        if (!isSource(entry.source) || !isOutcome(entry.outcome) || typeof entry.command !== "string" || typeof entry.createdAt !== "string") return [];
        return [{
          id: typeof entry.id === "string" ? entry.id.slice(0, 96) : "restored",
          source: entry.source,
          command: redactCommandContextText(entry.command),
          outcome: entry.outcome,
          targetNodeId: typeof entry.targetNodeId === "string" ? entry.targetNodeId.slice(0, 128) : undefined,
          detail: typeof entry.detail === "string" ? redactCommandContextText(entry.detail) : undefined,
          createdAt: entry.createdAt,
        }];
      }).slice(-MAX_SHARED_COMMAND_HISTORY)
    : [];
  const selectedHistoryId = typeof candidate.selectedHistoryId === "string" && history.some((entry) => entry.id === candidate.selectedHistoryId)
    ? candidate.selectedHistoryId
    : undefined;
  return { version: 1, targetNodeId, selectedHistoryId, history };
}

export function parseSharedCommandContext(serialized: string | null): SharedCommandContext {
  if (!serialized) return emptySharedCommandContext();
  try {
    return normalizeSharedCommandContext(JSON.parse(serialized));
  } catch {
    return emptySharedCommandContext();
  }
}

export function appendSharedCommandHistory(
  context: SharedCommandContext,
  input: Omit<SharedCommandHistoryEntry, "id" | "createdAt" | "command" | "detail"> & { command: string; detail?: string },
  now = new Date(),
): SharedCommandContext {
  const entry: SharedCommandHistoryEntry = {
    id: `${now.getTime()}-${input.source}-${context.history.length}`,
    source: input.source,
    command: redactCommandContextText(input.command),
    outcome: input.outcome,
    targetNodeId: input.targetNodeId?.slice(0, 128),
    detail: input.detail ? redactCommandContextText(input.detail) : undefined,
    createdAt: now.toISOString(),
  };
  const history = [...context.history, entry].slice(-MAX_SHARED_COMMAND_HISTORY);
  const selectedHistoryId = context.selectedHistoryId && history.some((item) => item.id === context.selectedHistoryId)
    ? context.selectedHistoryId
    : undefined;
  return { ...context, selectedHistoryId, history };
}

export function loadSharedCommandContext(): SharedCommandContext {
  if (typeof window === "undefined") return emptySharedCommandContext();
  try {
    return parseSharedCommandContext(window.localStorage.getItem(SHARED_COMMAND_CONTEXT_KEY));
  } catch {
    return emptySharedCommandContext();
  }
}

export function saveSharedCommandContext(context: SharedCommandContext): SharedCommandContext {
  const normalized = normalizeSharedCommandContext(context);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SHARED_COMMAND_CONTEXT_KEY, JSON.stringify(normalized));
    } catch {
      // Storage can be unavailable in private/restricted browser modes. Keep the UI fail-safe and in-memory.
    }
  }
  return normalized;
}

export function saveSharedTargetNode(targetNodeId: string): SharedCommandContext {
  const current = loadSharedCommandContext();
  return saveSharedCommandContext({ ...current, targetNodeId: targetNodeId ? targetNodeId.slice(0, 128) : undefined });
}

export function selectSharedHistoryEntry(selectedHistoryId: string): SharedCommandContext {
  const current = loadSharedCommandContext();
  const selected = current.history.some((entry) => entry.id === selectedHistoryId) ? selectedHistoryId : undefined;
  return saveSharedCommandContext({ ...current, selectedHistoryId: selected });
}

export function recordSharedCommand(
  input: Omit<SharedCommandHistoryEntry, "id" | "createdAt" | "command" | "detail"> & { command: string; detail?: string },
): SharedCommandContext {
  return saveSharedCommandContext(appendSharedCommandHistory(loadSharedCommandContext(), input));
}
