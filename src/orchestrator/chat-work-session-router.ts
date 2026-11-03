export type BridgeSurface = "chat" | "work";

export interface BridgeSessionRecord {
  project: string;
  surface: BridgeSurface;
  url: string;
  goalId: string | null;
  lastUsedAt: string;
}

export interface BridgeSessionRegistry {
  version: 1;
  project: string;
  sessions: BridgeSessionRecord[];
}

export interface BridgeTaskContext {
  text: string;
  goalId?: string | null;
  sourceCount?: number;
  crossApp?: boolean;
  recurring?: boolean;
  longRunning?: boolean;
  explicitSurface?: BridgeSurface;
  forceNew?: boolean;
}

export interface BridgeSessionDecision {
  surface: BridgeSurface;
  reuse: boolean;
  createNew: boolean;
  reason: string;
  session: BridgeSessionRecord | null;
}

const WORK_SIGNAL = /(?:複数(?:サービス|アプリ|資料|ソース)|定期(?:処理|作業)|長時間(?:処理|作業)|Gmail.{0,20}カレンダー|calendar.{0,20}gmail|cross[- ]app|multi[- ]source|multiple sources|recurring workflow|long[- ]running)/i;
const NEW_SIGNAL = /(?:新しい(?:チャット|chat|work)|新規(?:チャット|chat|work)|別(?:チャット|work)で|fresh (?:chat|work)|new (?:chat|work))/i;

export function inferBridgeSurface(context: BridgeTaskContext): BridgeSurface {
  if (context.explicitSurface) return context.explicitSurface;
  if (context.crossApp || context.recurring || context.longRunning || (context.sourceCount ?? 0) >= 3 || WORK_SIGNAL.test(context.text)) {
    return "work";
  }
  return "chat";
}

export function requestsFreshSurface(context: BridgeTaskContext): boolean {
  return context.forceNew === true || NEW_SIGNAL.test(context.text);
}

export function selectBridgeSession(
  context: BridgeTaskContext,
  registry: BridgeSessionRegistry,
): BridgeSessionDecision {
  const surface = inferBridgeSurface(context);
  if (requestsFreshSurface(context)) {
    return { surface, reuse: false, createNew: true, reason: "owner explicitly requested a fresh surface", session: null };
  }

  const candidates = registry.sessions
    .filter((session) => session.project === registry.project && session.surface === surface && /^https:\/\/chatgpt\.com\//.test(session.url))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

  const goalId = context.goalId?.trim() || null;
  if (goalId) {
    const sameGoal = candidates.find((session) => session.goalId === goalId);
    if (sameGoal) {
      return { surface, reuse: true, createNew: false, reason: "reuse same-goal project surface", session: sameGoal };
    }
  }

  const general = candidates.find((session) => session.goalId === null);
  if (general) {
    return { surface, reuse: true, createNew: false, reason: "reuse project default surface", session: general };
  }

  const recent = candidates[0];
  if (recent && !goalId) {
    return { surface, reuse: true, createNew: false, reason: "reuse most recent project surface", session: recent };
  }

  return { surface, reuse: false, createNew: true, reason: "no valid project-scoped surface exists", session: null };
}

export function upsertBridgeSession(
  registry: BridgeSessionRegistry,
  record: BridgeSessionRecord,
  maxSessions = 12,
): BridgeSessionRegistry {
  const key = (item: BridgeSessionRecord) => `${item.surface}:${item.goalId ?? "default"}`;
  const recordKey = key(record);
  const sessions = [
    record,
    ...registry.sessions.filter((item) => key(item) !== recordKey && item.url !== record.url),
  ]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, maxSessions);
  return { version: 1, project: registry.project, sessions };
}
