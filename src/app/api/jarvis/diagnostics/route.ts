import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { remoteDeviceInventory } from "../../../../jarvis/remote-device-inventory.ts";
import {
  buildJarvisSelfDiagnostics,
  type JarvisSelfDiagnosticInput,
} from "../../../../jarvis/self-diagnostics.ts";
import type { JarvisNode } from "../../../../jarvis/types.ts";
import {
  jarvisBrokerFetch,
  jarvisOwnerSecret,
  jarvisRemoteGatewayFetch,
  requireJarvisOwner,
} from "../broker.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BrokerState = {
  fleet?: JarvisNode[];
  activeTakeovers?: unknown[];
  stats?: { ready?: number; offline?: number; needsHuman?: number };
};

type GatewayDevice = { serial: string; state: string };
type GatewayState = { devices?: GatewayDevice[] };

function tailscaleStatus(): JarvisSelfDiagnosticInput["tailscale"] {
  if (process.env.VERCEL) return "unknown";
  const command = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  try {
    const raw = execFileSync(command, ["status", "--json"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(raw) as { BackendState?: unknown };
    return parsed.BackendState === "Running" ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

function firmwareStatus(): JarvisSelfDiagnosticInput["firmwareGate"] {
  if (process.env.VERCEL) return "unknown";
  if (process.platform === "win32") return "manual-required";
  if (process.platform === "darwin") return "not-applicable";
  return "unknown";
}

function unavailableAuthReport() {
  return {
    generatedAt: new Date().toISOString(),
    overall: "blocked" as const,
    items: [{
      code: "AUTH" as const,
      label: "Authentication",
      state: "blocked" as const,
      detail: "オーナー認証が必要です",
      action: "オーナー認証後にSelf Diagnosticsを再実行してください",
    }],
  };
}

export async function GET() {
  if (!(await requireJarvisOwner())) {
    return NextResponse.json(unavailableAuthReport(), { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const brokerConfigured = Boolean(process.env.JARVIS_BROKER_URL?.trim()) || !process.env.VERCEL;
  const gatewayConfigured = Boolean(process.env.JARVIS_REMOTE_GATEWAY_URL?.trim()) || !process.env.VERCEL;
  const brokerAuthConfigured = Boolean(process.env.JARVIS_OWNER_TOKEN?.trim());
  const gatewayAuthConfigured = Boolean(process.env.JARVIS_REMOTE_GATEWAY_TOKEN?.trim());

  let broker: JarvisSelfDiagnosticInput["broker"] = brokerConfigured ? "unknown" : "unconfigured";
  let gateway: JarvisSelfDiagnosticInput["gateway"] = gatewayConfigured ? "unknown" : "unconfigured";
  let brokerState: BrokerState | undefined;
  let gatewayState: GatewayState | undefined;

  if (brokerConfigured && !brokerAuthConfigured) {
    broker = "auth-missing";
  } else if (brokerConfigured) {
    try {
      const response = await jarvisBrokerFetch("/api/jarvis/admin/state", { signal: AbortSignal.timeout(3_000) });
      if (response.status === 401 || response.status === 403) broker = "auth-missing";
      else if (!response.ok) broker = "unreachable";
      else {
        const body = await response.json() as BrokerState;
        if (!Array.isArray(body.fleet)) throw new Error("invalid broker state");
        brokerState = body;
        broker = "ready";
      }
    } catch {
      broker = "unreachable";
    }
  }

  if (gatewayConfigured && !gatewayAuthConfigured) {
    gateway = "auth-missing";
  } else if (gatewayConfigured) {
    try {
      const response = await jarvisRemoteGatewayFetch("/api/remote/devices", { signal: AbortSignal.timeout(3_000) });
      if (response.status === 401 || response.status === 403) gateway = "auth-missing";
      else if (!response.ok) gateway = "unreachable";
      else {
        const body = await response.json() as GatewayState;
        if (!Array.isArray(body.devices)) throw new Error("invalid gateway state");
        gatewayState = body;
        gateway = "ready";
      }
    } catch {
      gateway = "unreachable";
    }
  }

  const fleet = brokerState?.fleet;
  const workerTotal = fleet?.length;
  const workerReady = brokerState?.stats?.ready ?? fleet?.filter((node) => node.status === "ready").length;
  const workerOffline = brokerState?.stats?.offline ?? fleet?.filter((node) => node.status === "offline").length;
  const humanGateCount = brokerState
    ? Math.max(brokerState.stats?.needsHuman ?? 0, brokerState.activeTakeovers?.length ?? 0)
    : undefined;

  const devicePermissionBlockers = fleet && gatewayState?.devices
    ? remoteDeviceInventory(fleet, gatewayState.devices)
      .filter((device) => device.remoteAssistCapability === null && device.state !== "offline")
      .map((device) => `${device.label}: ${device.reason}`)
    : undefined;

  const report = buildJarvisSelfDiagnostics({
    ownerAuthConfigured: Boolean(jarvisOwnerSecret()),
    brokerAuthConfigured,
    gatewayAuthConfigured,
    productionBuildPresent: process.env.VERCEL ? undefined : existsSync(join(process.cwd(), ".next", "BUILD_ID")),
    tailscale: tailscaleStatus(),
    hostObserved: !process.env.VERCEL || broker === "ready" ? true : undefined,
    broker,
    gateway,
    workerTotal,
    workerReady,
    workerOffline,
    devicePermissionBlockers,
    firmwareGate: firmwareStatus(),
    humanGateCount,
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    ...report,
  }, { headers: { "Cache-Control": "no-store" } });
}
