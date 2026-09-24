import { NextResponse } from "next/server";
import { jarvisBrokerFetch } from "../broker.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const brokerConfigured = Boolean(process.env.JARVIS_BROKER_URL?.trim());
  const ownerTokenConfigured = Boolean(process.env.JARVIS_OWNER_TOKEN?.trim());
  let brokerReachable = false;
  let directGoalBridgeReady = false;

  if (brokerConfigured && ownerTokenConfigured) {
    try {
      const response = await jarvisBrokerFetch("/health");
      const health = await response.json().catch(() => null) as { directGoalBridge?: { version?: unknown; executorReady?: unknown } } | null;
      brokerReachable = response.ok;
      directGoalBridgeReady = response.ok && health?.directGoalBridge?.version === 1 && health.directGoalBridge.executorReady === true;
    } catch {
      brokerReachable = false;
      directGoalBridgeReady = false;
    }
  }

  return NextResponse.json({
    ok: brokerConfigured && ownerTokenConfigured && brokerReachable && directGoalBridgeReady,
    brokerConfigured,
    ownerTokenConfigured,
    brokerReachable,
    directGoalBridgeReady,
  }, { status: brokerConfigured && ownerTokenConfigured && brokerReachable && directGoalBridgeReady ? 200 : 503 });
}
