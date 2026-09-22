import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import {
  inspectPrivateIngress,
  looksLikePublicFunnel,
} from "../scripts/jarvis-remote-access-lib.mjs";
import { serviceSpecs } from "../scripts/jarvis-managed-process.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function privateServeConfig(proxy = "http://127.0.0.1:3000", host = "jarvis-host.example.ts.net:443") {
  return {
    TCP: { "443": { HTTPS: true } },
    Web: {
      [host]: {
        Handlers: {
          "/": { Proxy: proxy },
        },
      },
    },
  };
}

test("SEC-010 accepts only private HTTPS Serve routed to the loopback dashboard", () => {
  const valid = inspectPrivateIngress(JSON.stringify(privateServeConfig()), {
    dnsName: "jarvis-host.example.ts.net",
    dashboardPort: 3000,
  });
  assert.deepEqual(valid, {
    state: "private",
    ready: true,
    reason: "Private HTTPS routes to the loopback dashboard",
  });

  for (const proxy of [
    "http://0.0.0.0:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8787",
    "https://127.0.0.1:3000",
  ]) {
    assert.equal(inspectPrivateIngress(JSON.stringify(privateServeConfig(proxy)), {
      dnsName: "jarvis-host.example.ts.net",
    }).ready, false);
  }

  assert.equal(inspectPrivateIngress(JSON.stringify(privateServeConfig()), {
    dnsName: "other-host.example.ts.net",
  }).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify(privateServeConfig()), {
    dashboardPort: 3333,
  }).ready, false);
});

test("SEC-010 refuses additional Serve handlers that expose protected backend ports", () => {
  for (const target of [
    "http://127.0.0.1:8787",
    "http://localhost:8790",
    "http://192.168.1.50:8787",
  ]) {
    const config = privateServeConfig();
    config.Web["jarvis-host.example.ts.net:443"].Handlers["/protected"] = { Proxy: target };
    const result = inspectPrivateIngress(JSON.stringify(config), {
      dnsName: "jarvis-host.example.ts.net",
    });
    assert.equal(result.ready, false);
    assert.equal(result.state, "unknown");
    assert.match(result.reason, /Protected backend exposed directly/);
  }
});

test("SEC-010 rejects public Funnel, malformed Funnel state, and unverifiable ingress", () => {
  for (const config of [
    { ...privateServeConfig(), AllowFunnel: true },
    { ...privateServeConfig(), AllowFunnel: { "jarvis-host.example.ts.net:443": true } },
    { ...privateServeConfig(), Foreground: { child: { AllowFunnel: true } } },
    { ...privateServeConfig(), AllowFunnel: { "jarvis-host.example.ts.net:443": "false" } },
  ]) {
    assert.equal(inspectPrivateIngress(JSON.stringify(config)).ready, false);
  }

  for (const output of ["", "null", "[]", "{}", "not-json", JSON.stringify({ UnknownField: {} })]) {
    assert.equal(inspectPrivateIngress(output).ready, false);
  }
  assert.equal(inspectPrivateIngress(JSON.stringify(privateServeConfig()), { commandSucceeded: false }).ready, false);

  assert.equal(looksLikePublicFunnel("Available on the internet:\nhttps://host.example.ts.net"), true);
  assert.equal(looksLikePublicFunnel("Available within your tailnet:\nhttps://host.example.ts.net"), false);
});

test("SEC-010 supervised dashboard remains loopback-bound", () => {
  const specs = serviceSpecs("/repo", "/node", "3000");
  const dashboard = specs.find((spec) => spec.name === "dashboard");
  assert.ok(dashboard);
  assert.deepEqual(dashboard.args.slice(-5), ["start", "-H", "127.0.0.1", "-p", "3000"]);
  assert.equal(dashboard.args.includes("0.0.0.0"), false);

  const broker = specs.find((spec) => spec.name === "broker");
  const gateway = specs.find((spec) => spec.name === "remote-gateway");
  assert.ok(broker?.args[0].endsWith("scripts/jarvis-broker.ts"));
  assert.ok(gateway?.args[0].endsWith("scripts/jarvis-remote-gateway.ts"));
});

test("SEC-010 Broker, Remote Gateway, and supervisor defaults fail closed around loopback", () => {
  const broker = read("scripts/jarvis-broker.ts");
  const gateway = read("scripts/jarvis-remote-gateway.ts");
  const host = read("scripts/jarvis-remote-host.mjs");

  assert.match(broker, /JARVIS_BROKER_HOST\?\.trim\(\) \|\| "127\.0\.0\.1"/);
  assert.match(broker, /host !== "127\.0\.0\.1" && host !== "::1" && process\.env\.JARVIS_ALLOW_NON_LOOPBACK !== "1"/);
  assert.match(broker, /Refusing non-loopback broker bind/);

  assert.match(gateway, /JARVIS_REMOTE_GATEWAY_HOST\?\.trim\(\) \|\| "127\.0\.0\.1"/);
  assert.match(gateway, /host !== "127\.0\.0\.1" && host !== "::1" && process\.env\.JARVIS_REMOTE_ALLOW_NON_LOOPBACK !== "1"/);
  assert.match(gateway, /Refusing non-loopback remote gateway bind/);

  assert.match(host, /JARVIS_BROKER_URL: process\.env\.JARVIS_BROKER_URL \|\| 'http:\/\/127\.0\.0\.1:8787'/);
  assert.match(host, /JARVIS_REMOTE_GATEWAY_URL: process\.env\.JARVIS_REMOTE_GATEWAY_URL \|\| 'http:\/\/127\.0\.0\.1:8790'/);
});
