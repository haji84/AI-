import { NextResponse } from "next/server";
import { jarvisBrokerFetch } from "../broker.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const brokerConfigured = Boolean(process.env.JARVIS_BROKER_URL?.trim());
  const ownerTokenConfigured = Boolean(process.env.JARVIS_OWNER_TOKEN?.trim());
  let brokerReachable = false;

  if (brokerConfigured && ownerTokenConfigured) {
    try {
      const response = await jarvisBrokerFetch("/health");
      brokerReachable = response.ok;
    } catch {
      brokerReachable = false;
    }
  }

  return NextResponse.json({
    ok: brokerConfigured && ownerTokenConfigured && brokerReachable,
    brokerConfigured,
    ownerTokenConfigured,
    brokerReachable,
  }, { status: brokerConfigured && ownerTokenConfigured && brokerReachable ? 200 : 503 });
}
