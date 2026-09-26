import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TrustedDeviceRegistry } from "../src/jarvis/trusted-device-registry.ts";

const first = "device_1234567890abcdef";
const second = "device_abcdef1234567890";

test("trusted device revocation survives reopening and cannot be undone by registration", () => {
  const dir = mkdtempSync(join(tmpdir(), "trusted-device-registry-"));
  const path = join(dir, "registry.json");
  try {
    const registry = new TrustedDeviceRegistry(path);
    registry.register(first, "iPhone");
    registry.register(second, "ZBook");
    assert.deepEqual(registry.list().map(item => item.deviceId), [first, second]);
    assert.equal(registry.revoke(first).revoked, true);
    assert.equal(new TrustedDeviceRegistry(path).isRevoked(first), true);
    assert.equal(new TrustedDeviceRegistry(path).isRevoked(second), false);
    assert.throws(() => registry.register(first, "re-enroll"), /revoked/);
    assert.equal(registry.revoke(first).revoked, true);
    assert.ok(!readFileSync(path, "utf8").includes("credential"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unregistered legacy device can be revoked and corrupt state fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "trusted-device-registry-"));
  const path = join(dir, "registry.json");
  try {
    const registry = new TrustedDeviceRegistry(path);
    registry.revoke(first);
    assert.equal(new TrustedDeviceRegistry(path).isRevoked(first), true);
    assert.throws(() => registry.register("bad/id", "phone"));
    writeFileSync(path, '{"version":1,"devices":[],' );
    assert.throws(() => registry.isRevoked(second));
    assert.throws(() => registry.list());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("version-one device files remain readable without a recovery-state rewrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "trusted-device-registry-"));
  const path = join(dir, "registry.json");
  const original = JSON.stringify({ version: 1, devices: [{ deviceId: first, label: "Existing iPhone", revoked: false }] });
  try {
    writeFileSync(path, original);
    const registry = new TrustedDeviceRegistry(path);
    assert.deepEqual(registry.list(), [{ deviceId: first, label: "Existing iPhone", revoked: false }]);
    assert.equal(registry.isRevoked(first), false);
    assert.equal(readFileSync(path, "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
