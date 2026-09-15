import { NextResponse } from "next/server";
import { remoteAssistDescriptorForNode } from "../../../../jarvis/remote-assist-node-capability.ts";
import type { JarvisNode } from "../../../../jarvis/types.ts";
import { jarvisBrokerFetch, requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";

function isJarvisNode(value: unknown): value is JarvisNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<JarvisNode>;
  return typeof candidate.kind === "string"
    && typeof candidate.status === "string"
    && Array.isArray(candidate.capabilities)
    && Boolean(candidate.policy)
    && typeof candidate.policy?.allowRemoteControl === "boolean";
}

function enrichRemoteAssist(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const state = body as Record<string, unknown>;
  if (!Array.isArray(state.fleet)) return body;
  return {
    ...state,
    fleet: state.fleet.map((node) => isJarvisNode(node)
      ? { ...node, remoteAssist: remoteAssistDescriptorForNode(node) }
      : node),
  };
}

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/state");
    const body = await response.json().catch(() => ({ message: "JARVIS Brokerから不正な応答を受信しました" }));
    return NextResponse.json(response.ok ? enrichRemoteAssist(body) : body, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      message: "JARVIS Brokerに接続できません",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 503 });
  }
}
