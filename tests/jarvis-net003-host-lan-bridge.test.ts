import assert from "node:assert/strict";
import test from "node:test";
import { inspectPrivateIngress } from "../scripts/jarvis-remote-access-lib.mjs";
import {
  JARVIS_MAX_NODES,
  JarvisFleetManager,
  resolveJarvisRoute,
  type JarvisNode,
} from "../src/jarvis/index.ts";

function androidNode(index: number): JarvisNode {
  const id = `android-${String(index).padStart(3, "0")}`;
  return {
    id,
    label: id,
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "background-worker"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 80,
      charging: true,
      network: "wifi",
      checkedAt: "2026-09-22T09:00:00.000Z",
    },
    enrollment: "fleet",
    lastSeenAt: "2026-09-22T09:00:00.000Z",
  };
}

function serveConfig(extraHandlers: Record<string, { Proxy: string }> = {}) {
  return {
    TCP: { "443": { HTTPS: true } },
    Web: {
      "host.example.ts.net:443": {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:3000" },
          ...extraHandlers,
        },
      },
    },
  };
}

test("NET-003 private host ingress exposes only the Dashboard, never Broker or Remote Gateway directly", () => {
  assert.equal(inspectPrivateIngress(JSON.stringify(serveConfig()), { dnsName: "host.example.ts.net" }).ready, true);

  for (const [path, target] of [
    ["/broker", "http://127.0.0.1:8787"],
    ["/remote", "http://localhost:8790"],
  ] as const) {
    const result = inspectPrivateIngress(JSON.stringify(serveConfig({ [path]: { Proxy: target } })), {
      dnsName: "host.example.ts.net",
    });
    assert.equal(result.ready, false);
    assert.equal(result.state, "unknown");
    assert.match(result.reason, /Protected backend exposed directly/);
  }
});

test("NET-003 software topology keeps a 100-node Android fleet on the LAN side of one private host", () => {
  const ingress = inspectPrivateIngress(JSON.stringify(serveConfig()), { dnsName: "host.example.ts.net" });
  assert.equal(ingress.ready, true);

  const lanRoute = resolveJarvisRoute({ mobileOnline: false, pcOnline: true, sameLanAvailable: true });
  assert.equal(lanRoute.mode, "lan-only");

  const fleet = new JarvisFleetManager();
  for (let i = 1; i <= JARVIS_MAX_NODES; i += 1) fleet.register(androidNode(i));
  assert.equal(JARVIS_MAX_NODES, 100);
  assert.equal(fleet.list().length, 100);
  assert(fleet.list().every((node) => node.kind === "android" && node.telemetry.network === "wifi"));
});
