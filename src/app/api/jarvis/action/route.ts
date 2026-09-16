import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

type JarvisDeviceTaskType =
  | "open-url"
  | "open-app"
  | "launch-settings"
  | "wake-device"
  | "device-status"
  | "show-notification"
  | "lock-device"
  | "reboot"
  | "ui-sequence";

type JarvisDashboardAction =
  | { action: "enrollment"; mode?: "quick" | "full" | "fleet"; maxDevices?: number; group?: string; ttlMs?: number }
  | { action: "pairing-window"; operation?: "open" | "close" | "status"; maxIssues?: number; group?: string; ttlMs?: number }
  | { action: "replacement-ready" }
  | { action: "replacement-discard"; candidateId?: string }
  | { action: "open-url"; url?: string; targetNodeId?: string; allowJavaScript?: boolean }
  | { action: "device-task"; type?: JarvisDeviceTaskType; payload?: Record<string, unknown>; targetNodeId?: string; priority?: string }
  | { action: "resolve-takeover"; sessionId?: string; resumeTask?: boolean };

const allowedTaskTypes = new Set<JarvisDeviceTaskType>([
  "open-url",
  "open-app",
  "launch-settings",
  "wake-device",
  "device-status",
  "show-notification",
  "lock-device",
  "reboot",
  "ui-sequence",
]);

function safeReplacementReady(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { candidates: [], pendingCount: 0 };
  const source = result as Record<string, unknown>;
  const candidates = Array.isArray(source.candidates) ? source.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.candidateId !== "string"
      || typeof item.nodeId !== "string"
      || typeof item.publicKeyFingerprint !== "string"
      || typeof item.verifiedAt !== "string"
      || typeof item.expiresAt !== "string"
      || item.status !== "READY_FOR_HUMAN_GATE"
      || item.requiresHumanGate !== true
    ) return [];
    return [{
      candidateId: item.candidateId,
      nodeId: item.nodeId,
      publicKeyFingerprint: item.publicKeyFingerprint,
      verifiedAt: item.verifiedAt,
      expiresAt: item.expiresAt,
      status: "READY_FOR_HUMAN_GATE" as const,
      requiresHumanGate: true as const,
    }];
  }) : [];
  return {
    candidates,
    pendingCount: typeof source.pendingCount === "number" && Number.isFinite(source.pendingCount) ? Math.max(0, Math.trunc(source.pendingCount)) : 0,
  };
}

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as JarvisDashboardAction | null;
  if (!payload?.action) return NextResponse.json({ message: "操作内容がありません" }, { status: 400 });

  let path: string;
  let method = "POST";
  let body: Record<string, unknown> | undefined;
  if (payload.action === "enrollment") {
    path = "/api/jarvis/admin/enrollment";
    body = {
      mode: payload.mode ?? "quick",
      maxDevices: payload.maxDevices ?? (payload.mode === "fleet" ? 100 : 1),
      group: payload.group,
      ttlMs: payload.ttlMs,
    };
  } else if (payload.action === "pairing-window") {
    path = "/api/jarvis/admin/enrollment-window";
    if (payload.operation === "status") {
      method = "GET";
    } else {
      body = {
        action: payload.operation === "close" ? "close" : "open",
        maxIssues: payload.maxIssues,
        group: payload.group,
        ttlMs: payload.ttlMs,
      };
    }
  } else if (payload.action === "replacement-ready") {
    path = "/api/jarvis/admin/replacement/ready";
    method = "GET";
  } else if (payload.action === "replacement-discard") {
    if (!payload.candidateId) return NextResponse.json({ message: "Replacement candidate IDが必要です" }, { status: 400 });
    path = "/api/jarvis/admin/replacement/discard";
    body = { candidateId: payload.candidateId };
  } else if (payload.action === "open-url") {
    if (!payload.url?.startsWith("https://")) return NextResponse.json({ message: "HTTPS URLを指定してください" }, { status: 400 });
    path = "/api/jarvis/admin/tasks";
    body = {
      type: "open-url",
      payload: { url: payload.url, allowJavaScript: payload.allowJavaScript === true },
      targetNodeId: payload.targetNodeId || undefined,
    };
  } else if (payload.action === "device-task") {
    if (!payload.type || !allowedTaskTypes.has(payload.type)) return NextResponse.json({ message: "未対応の端末タスクです" }, { status: 400 });
    path = "/api/jarvis/admin/tasks";
    body = {
      type: payload.type,
      payload: payload.payload ?? {},
      targetNodeId: payload.targetNodeId || undefined,
      priority: payload.priority,
    };
  } else {
    if (!payload.sessionId) return NextResponse.json({ message: "Takeover session IDが必要です" }, { status: 400 });
    path = "/api/jarvis/admin/takeover/resolve";
    body = { sessionId: payload.sessionId, resumeTask: payload.resumeTask !== false };
  }

  try {
    const response = await jarvisBrokerFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => ({ message: "JARVIS Brokerから不正な応答を受信しました" }));
    if (response.ok && payload.action === "replacement-ready") return NextResponse.json(safeReplacementReady(result), { status: response.status });
    if (response.ok && payload.action === "replacement-discard") {
      const source = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      return NextResponse.json({ discarded: source.discarded === true }, { status: response.status });
    }
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    const setupAction = payload.action === "enrollment" || payload.action === "pairing-window" || payload.action === "replacement-ready" || payload.action === "replacement-discard";
    return NextResponse.json({
      message: setupAction ? "端末登録・交換設定を更新できません。JARVIS Brokerの接続設定を確認してください。" : "JARVIS Brokerに接続できません",
      detail,
    }, { status: 503 });
  }
}
