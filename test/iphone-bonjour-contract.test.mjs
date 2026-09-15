import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const bridge = await readFile(new URL("../scripts/iphone-bridge-server.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../apps/ios-worker/Sources/WorkerRuntime.swift", import.meta.url), "utf8");
const bonjour = await readFile(new URL("../apps/ios-worker/Sources/BonjourBridgeDiscovery.swift", import.meta.url), "utf8");
const plist = await readFile(new URL("../apps/ios-worker/Info.plist", import.meta.url), "utf8");

test("bridge defaults to an OS-selected port and advertises Bonjour", () => {
  assert.match(bridge, /IPHONE_BRIDGE_PORT === undefined \? 0/);
  assert.match(bridge, /_jarvisiphone\._tcp/);
  assert.match(bridge, /spawn\("dns-sd"/);
  assert.match(bridge, /actualPort/);
});

test("iPhone discovers Bonjour before bounded legacy scan fallback", () => {
  const bonjourIndex = worker.indexOf("BonjourBridgeDiscovery.findBridge");
  const fallbackIndex = worker.indexOf("fallbackPorts");
  assert.ok(bonjourIndex >= 0);
  assert.ok(fallbackIndex > bonjourIndex);
  assert.match(worker, /bridgeURL = try await discoverBridge\(\)/);
  assert.match(worker, /try await reconnect\(\)/);
});

test("Bonjour discovery and iOS privacy declaration use the same service type", () => {
  assert.match(bonjour, /_jarvisiphone\._tcp\./);
  assert.match(plist, /_jarvisiphone\._tcp/);
  assert.match(plist, /NSLocalNetworkUsageDescription/);
  assert.match(plist, /NSBonjourServices/);
});
