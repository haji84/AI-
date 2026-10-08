import { NextResponse } from "next/server";
import { requireJarvisOwner } from "../../../jarvis/broker.ts";
import { listTrustedDevices, revokeTrustedDevice } from "../../../../trusted-device-registry-client.ts";

export async function GET() {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  try { return NextResponse.json({ devices: await listTrustedDevices() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ message: "端末一覧を確認できません" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { deviceId?: unknown } | null;
  if (typeof payload?.deviceId !== "string" || !/^[A-Za-z0-9_-]{16,96}$/.test(payload.deviceId)) return NextResponse.json({ message: "端末IDが不正です" }, { status: 400 });
  try {
    await revokeTrustedDevice(payload.deviceId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ message: "端末を失効できません" }, { status: 503 }); }
}
