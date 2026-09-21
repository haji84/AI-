import { NextResponse } from "next/server";

import {
  readJarvisRecoveryDashboard,
  unavailableRecoveryDashboard,
} from "../../../../jarvis/recovery-dashboard.ts";
import { requireJarvisOwner } from "../broker.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!(await requireJarvisOwner())) {
    return response(unavailableRecoveryDashboard("Owner authentication is required."), 401);
  }

  const filePath = process.env.JARVIS_PRODUCTION_RUNS_FILE?.trim();
  if (!filePath) {
    return response(unavailableRecoveryDashboard("Recovery persistence path is not configured on this runtime."));
  }

  try {
    return response(await readJarvisRecoveryDashboard(filePath));
  } catch {
    return response(unavailableRecoveryDashboard("Recovery persistence could not be read safely."), 503);
  }
}
