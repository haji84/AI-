import assert from "node:assert/strict";
import test from "node:test";
import { LocalDeviceMesh, type MeshEnvelope } from "../src/gai/local-device-mesh.ts";

function pair() {
  const sent: MeshEnvelope[] = [];
  const a = new LocalDeviceMesh({ peerId: "zbook", secret: "shared-test-key", capabilities: ["local-model", "filesystem"], transport: { async send(e) { sent.push(e); } } });
  const b = new LocalDeviceMesh({ peerId: "mac", secret: "shared-test-key", capabilities: ["local-model", "browser"], transport: { async send(e) { sent.push(e); } } });
  a.registerPeer({ id: "mac", capabilities: ["local-model", "browser"], available: true });
  b.registerPeer({ id: "zbook", capabilities: ["local-model", "filesystem"], available: true });
  return { a, b, sent };
}

test("exchanges authenticated bounded task over transport-neutral local mesh", async () => {
  const { a, b, sent } = pair();
  await a.dispatch("task", "mac", { taskId: "t1", requiredCapability: "browser", body: "inspect local page" }, "n1", 1000);
  assert.equal(sent.length, 1);
  assert.equal(b.receive(sent[0], 1001).taskId, "t1");
});

test("rejects tampering", () => {
  const { a, b } = pair();
  const envelope = a.createEnvelope("task", "mac", { taskId: "t1", requiredCapability: "browser", body: "safe" }, "n2", 1000);
  assert.throws(() => b.receive({ ...envelope, payload: { ...envelope.payload, body: "tampered" } }, 1001), /signature invalid/);
});

test("rejects replay", () => {
  const { a, b } = pair();
  const envelope = a.createEnvelope("task", "mac", { taskId: "t1", requiredCapability: "browser", body: "x" }, "n3", 1000);
  b.receive(envelope, 1001);
  assert.throws(() => b.receive(envelope, 1002), /replay/);
});

test("rejects expiry and wrong recipient", () => {
  const { a, b } = pair();
  const envelope = a.createEnvelope("task", "mac", { taskId: "t1", requiredCapability: "browser", body: "x" }, "n4", 1000, 10);
  assert.throws(() => b.receive(envelope, 1011), /expired/);
  assert.throws(() => a.receive(envelope, 1001), /another peer/);
});

test("requires recipient capability and deterministic available peer selection", () => {
  const { a } = pair();
  a.registerPeer({ id: "aa-mac", capabilities: ["browser"], available: true });
  assert.equal(a.selectPeer("browser")?.id, "aa-mac");
  assert.throws(() => a.createEnvelope("task", "mac", { taskId: "t2", requiredCapability: "filesystem", body: "x" }, "n5", 1000), /lacks required capability/);
});

test("preserves Human Gate before dispatch", () => {
  const { a } = pair();
  assert.throws(() => a.createEnvelope("task", "mac", { taskId: "t3", requiredCapability: "browser", body: "publish", humanGateRequired: true, humanGateApproved: false }, "n6", 1000), /human gate/);
});

test("result envelopes use the same authenticated offline-capable protocol", () => {
  const { a, b } = pair();
  const envelope = b.createEnvelope("result", "zbook", { taskId: "t4", requiredCapability: "local-model", body: "done" }, "n7", 1000);
  assert.equal(a.receive(envelope, 1001).body, "done");
});
