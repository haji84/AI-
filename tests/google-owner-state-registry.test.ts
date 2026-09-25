import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GoogleOwnerStateRegistry } from "../src/jarvis/google-owner-state-registry.ts";

const device = "device_1234567890abcdef";

test("first bind requires verified bootstrap email and persists immutable sub", () => {
  const dir = mkdtempSync(join(tmpdir(), "google-owner-"));
  try {
    const path = join(dir, "state.json");
    const store = new GoogleOwnerStateRegistry(path);
    assert.throws(() => store.bindIdentity({ sub: "s1", email: "owner@example.com", emailVerified: false, bootstrapEmail: "owner@example.com" }, 1000));
    assert.throws(() => store.bindIdentity({ sub: "s1", email: "other@example.com", emailVerified: true, bootstrapEmail: "owner@example.com" }, 1000));
    store.bindIdentity({ sub: "s1", email: "owner@example.com", emailVerified: true, bootstrapEmail: "owner@example.com" }, 1000);
    const reopened = new GoogleOwnerStateRegistry(path);
    assert.equal(reopened.identity()?.sub, "s1");
    assert.doesNotThrow(() => reopened.bindIdentity({ sub: "s1", email: "changed@example.com", emailVerified: true, bootstrapEmail: "owner@example.com" }, 1001));
    assert.throws(() => reopened.bindIdentity({ sub: "s2", email: "owner@example.com", emailVerified: true, bootstrapEmail: "owner@example.com" }, 1002));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("durable context consumption survives restart and rejects replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "google-owner-"));
  try {
    const path = join(dir, "state.json");
    const store = new GoogleOwnerStateRegistry(path);
    const context = store.issueContext({ deviceId: device, publicKeyThumbprint: "thumb", state: "state", nonce: "nonce", pkceChallenge: "pkce" }, 1000);
    const reopened = new GoogleOwnerStateRegistry(path);
    assert.equal(reopened.consumeContext({ ...context, deviceId: device, publicKeyThumbprint: "thumb", state: "state", nonce: "nonce" }, 1001).pkceChallenge, "pkce");
    assert.throws(() => new GoogleOwnerStateRegistry(path).consumeContext({ ...context, deviceId: device, publicKeyThumbprint: "thumb", state: "state", nonce: "nonce" }, 1002));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("corrupt persisted Google Owner state fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "google-owner-"));
  try {
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ version: 1, identity: { provider: "google", sub: "", boundAt: 0, version: 1 }, contexts: [] }));
    assert.throws(() => new GoogleOwnerStateRegistry(path).identity());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
