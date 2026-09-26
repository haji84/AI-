import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generateOwnerRecoveryCode,
  normalizeOwnerRecoveryCode,
  TrustedDeviceRegistry,
} from "../src/jarvis/trusted-device-registry.ts";

const secret = "broker-owner-token-for-recovery-tests";
const issuer = "issuer_1234567890abcdef";
const target = "target_1234567890abcdef";
const thumbprint = "T".repeat(43);
const source = "S".repeat(43);
const code = generateOwnerRecoveryCode(Buffer.alloc(10));
const otherCode = generateOwnerRecoveryCode(Buffer.alloc(10, 1));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "owner-recovery-registry-"));
  const path = join(dir, "registry.json");
  const registry = new TrustedDeviceRegistry(path, secret);
  registry.register(issuer, "Trusted iPhone");
  return { dir, path, registry };
}

function redeemInput(overrides: Record<string, string> = {}) {
  return { code, deviceId: target, label: "New iPhone", publicKeyThumbprint: thumbprint, sourceBucket: source, ...overrides };
}

test("recovery codes encode exactly eighty bits using the unambiguous display alphabet", () => {
  assert.equal(code, "OR-AAAA-AAAA-AAAA-AAAA");
  assert.match(otherCode, /^OR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.notEqual(code, otherCode);
  assert.equal(normalizeOwnerRecoveryCode("or aaaa-aaaa aaaa-aaaa"), "AAAAAAAAAAAAAAAA");
  for (const malformed of ["", "OR-AAAA", "OR-AAAA-AAAA-AAAA-AAAI", "OR-AAAA-AAAA-AAAA-AAAA-X"]) {
    assert.throws(() => normalizeOwnerRecoveryCode(malformed), /invalid owner recovery code/);
  }
});

test("only a live registered issuer may issue and the fourth hourly issue is rejected", () => {
  const { dir, registry } = fixture();
  try {
    assert.throws(() => registry.issueRecovery({ issuerDeviceId: target, code }, 1000), /recovery rejected/);
    const first = registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    const second = registry.issueRecovery({ issuerDeviceId: issuer, code: otherCode }, 1001);
    const third = registry.issueRecovery({ issuerDeviceId: issuer, code }, 1002);
    assert.equal(first.expiresAt, 1300);
    assert.equal(typeof first.recoveryId, "string");
    assert.deepEqual(Object.keys(first).sort(), ["expiresAt", "recoveryId"]);
    assert.notEqual(first.recoveryId, second.recoveryId);
    assert.notEqual(second.recoveryId, third.recoveryId);
    assert.throws(() => registry.issueRecovery({ issuerDeviceId: issuer, code: otherCode }, 1003), /rate limit/);
    assert.doesNotThrow(() => registry.issueRecovery({ issuerDeviceId: issuer, code: otherCode }, 4601));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("durable state stores only a digest and replacement invalidates the earlier code", () => {
  const { dir, path, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    registry.issueRecovery({ issuerDeviceId: issuer, code: otherCode }, 1001);
    const persisted = readFileSync(path, "utf8");
    assert.doesNotMatch(persisted, /OR-AAAA|AAAAAAAAAAAAAAAA/);
    assert.match(persisted, /"codeDigest":"[A-Za-z0-9_-]{43}"/);
    assert.throws(() => registry.redeemRecovery(redeemInput(), 1002), /recovery rejected/);
    assert.equal(registry.redeemRecovery(redeemInput({ code: otherCode }), 1002).deviceId, target);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("redemption is valid through the five-minute boundary and fails after it", () => {
  for (const [now, accepted] of [[1300, true], [1301, false]] as const) {
    const { dir, registry } = fixture();
    try {
      registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
      if (accepted) assert.equal(registry.redeemRecovery(redeemInput(), now).deviceId, target);
      else assert.throws(() => registry.redeemRecovery(redeemInput(), now), /recovery rejected/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("an expired active record is closed as bounded non-secret audit metadata", () => {
  const { dir, path, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    assert.throws(() => registry.redeemRecovery(redeemInput(), 1301), /recovery rejected/);
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.recovery.active, undefined);
    assert.equal(state.recovery.history.at(-1).status, "expired");
    assert.doesNotMatch(JSON.stringify(state.recovery.history.at(-1)), /OR-AAAA|AAAAAAAAAAAAAAAA/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("consume wins once and binds target key metadata without duplicate devices", () => {
  const { dir, path, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    assert.equal(registry.redeemRecovery(redeemInput(), 1001).deviceId, target);
    assert.throws(() => registry.redeemRecovery(redeemInput(), 1001), /recovery rejected/);
    assert.equal(registry.list().filter(device => device.deviceId === target).length, 1);
    const state = JSON.parse(readFileSync(path, "utf8"));
    const consumed = state.recovery.history.find((item: { status: string }) => item.status === "consumed");
    assert.equal(consumed.targetDeviceId, target);
    assert.equal(consumed.publicKeyThumbprint, thumbprint);
    assert.equal(consumed.consumedAt, 1001);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cancellation, issuer revocation, and revoked target ids fail closed", () => {
  const { dir, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    assert.deepEqual(registry.cancelRecovery(issuer, 1001), { cancelled: true });
    assert.deepEqual(registry.cancelRecovery(issuer, 1002), { cancelled: false });
    assert.throws(() => registry.redeemRecovery(redeemInput(), 1002), /recovery rejected/);

    registry.issueRecovery({ issuerDeviceId: issuer, code: otherCode }, 1003);
    registry.revoke(issuer);
    assert.throws(() => registry.redeemRecovery(redeemInput({ code: otherCode }), 1004), /recovery rejected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const second = fixture();
  try {
    second.registry.revoke(target);
    second.registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    assert.throws(() => second.registry.redeemRecovery(redeemInput(), 1001), /recovery rejected/);
  } finally { rmSync(second.dir, { recursive: true, force: true }); }
});

test("redeem attempts are limited per HMACed source and globally without persisting raw source", () => {
  const { dir, path, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.throws(() => registry.redeemRecovery(redeemInput({ code: otherCode }), 1001 + attempt), /recovery rejected/);
    }
    assert.throws(() => registry.redeemRecovery(redeemInput({ code: otherCode }), 1011), /rate limit/);
    const persisted = readFileSync(path, "utf8");
    assert.doesNotMatch(persisted, /192\.0\.2\.|raw-source/);
    assert.match(persisted, new RegExp(source));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const global = fixture();
  try {
    global.registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    for (let bucket = 0; bucket < 10; bucket += 1) {
      const sourceBucket = String(bucket).padStart(43, "B");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        assert.throws(() => global.registry.redeemRecovery(redeemInput({ code: otherCode, sourceBucket }), 1001), /recovery rejected/);
      }
    }
    assert.throws(() => global.registry.redeemRecovery(redeemInput({ code: otherCode, sourceBucket: "G".repeat(43) }), 1002), /rate limit/);
  } finally { rmSync(global.dir, { recursive: true, force: true }); }
});

test("a failed atomic save leaves both the active code and device list unchanged", () => {
  const { dir, path, registry } = fixture();
  try {
    registry.issueRecovery({ issuerDeviceId: issuer, code }, 1000);
    const failing = new TrustedDeviceRegistry(path, secret, () => { throw new Error("simulated save failure"); });
    assert.throws(() => failing.redeemRecovery(redeemInput(), 1001), /simulated save failure/);
    const reopened = new TrustedDeviceRegistry(path, secret);
    assert.deepEqual(reopened.list().map(device => device.deviceId), [issuer]);
    assert.equal(reopened.redeemRecovery(redeemInput(), 1002).deviceId, target);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
