import { NextResponse } from "next/server";
import { jarvisBrokerFetch, requireJarvisOwner } from "../../broker.ts";

export async function GET(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const goalId = new URL(request.url).searchParams.get("goalId")?.trim();
  const suffix = goalId ? `?goalId=${encodeURIComponent(goalId)}` : "";
  try {
    const response = await jarvisBrokerFetch(`/api/jarvis/admin/bridge/events${suffix}`);
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ message: "GORIQ Runtimeに接続できません" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { eventId?: unknown } | null;
  if (typeof payload?.eventId !== "string" || !payload.eventId) return NextResponse.json({ message: "eventId required" }, { status: 400 });
  try {
    const response = await jarvisBrokerFetch("/api/jarvis/admin/bridge/events/ack", { method: "POST", body: JSON.stringify({ eventId: payload.eventId }) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ message: "GORIQ Runtimeに接続できません" }, { status: 503 }); }
}
