import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { inspectPrivateIngress, privateServeUrl } from "../scripts/jarvis-remote-access-lib.mjs";
import { serviceSpecs } from "../scripts/jarvis-managed-process.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function privateServeConfig(host = "zbook.example.ts.net:443") {
  return {
    TCP: { "443": { HTTPS: true } },
    Web: {
      [host]: {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:3000" },
        },
      },
    },
  };
}

test("ACC-001 derives a stable private HTTPS owner URL only from Tailscale DNS identity", () => {
  assert.equal(
    privateServeUrl({ Self: { DNSName: "zbook.example.ts.net." } }),
    "https://zbook.example.ts.net",
  );
  assert.equal(privateServeUrl({ Self: { DNSName: "" } }), null);
  assert.equal(privateServeUrl({}), null);

  const ingress = inspectPrivateIngress(JSON.stringify(privateServeConfig()), {
    dnsName: "zbook.example.ts.net",
    dashboardPort: 3000,
  });
  assert.deepEqual(ingress, {
    state: "private",
    ready: true,
    reason: "Private HTTPS routes to the loopback dashboard",
  });
});

test("ACC-001 fails closed on public, mismatched, or unverifiable ingress", () => {
  const publicConfig = { ...privateServeConfig(), AllowFunnel: true };
  assert.equal(inspectPrivateIngress(JSON.stringify(publicConfig)).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify(privateServeConfig()), {
    dnsName: "other.example.ts.net",
  }).ready, false);
  assert.equal(inspectPrivateIngress("", { commandSucceeded: false }).ready, false);
});

test("ACC-001 keeps the dashboard loopback-bound and gates the JARVIS UI on owner authentication", async () => {
  const specs = serviceSpecs("/repo", "/node", "3000");
  const dashboard = specs.find((spec) => spec.name === "dashboard");
  assert.ok(dashboard);
  assert.deepEqual(dashboard.args.slice(-5), ["start", "-H", "127.0.0.1", "-p", "3000"]);

  const [page, broker] = await Promise.all([
    source("src/app/jarvis/page.tsx"),
    source("src/app/api/jarvis/broker.ts"),
  ]);
  assert.match(page, /if \(!await requireJarvisOwner\(\)\) return <main[^>]*><OwnerLogin \/><\/main>;/);
  assert.match(page, /<JarvisConsole \/>/);
  assert.match(broker, /if \(!ownerSecret\) return false;/);
  assert.match(broker, /verifyOwnerSessionToken\(ownerSecret, cookieStore\.get\(OWNER_SESSION_COOKIE\)\?\.value\)/);
});
