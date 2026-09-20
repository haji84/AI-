import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OwnerRecoveryStore } from "../src/jarvis/owner-recovery-store.ts";

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-recovery-"));
  const file = join(dir, "state.json");
  return { dir, store: new OwnerRecoveryStore(file, "owner-secret") };
}

test("recovery email registration requires delivered code verification", async () => {
  const { dir, store } = tempStore();
  let code = "";
  try {
    await store.startRegistration("owner@example.com", async input => { code = input.code; }, new Date("2026-09-20T00:00:00Z"));
    assert.equal(store.status().configured, false);
    const status = store.verifyRegistration(code, new Date("2026-09-20T00:01:00Z"));
    assert.equal(status.configured, true);
    assert.equal(status.maskedEmail, "o***@example.com");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recovery start is privacy-preserving for a non-matching address", async () => {
  const { dir, store } = tempStore();
  let deliveries = 0;
  try {
    const result = await store.startRecovery("nobody@example.com", async () => { deliveries += 1; });
    assert.equal(result.accepted, true);
    assert.equal(deliveries, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("successful recovery creates a 24 hour restriction and code is single use", async () => {
  const { dir, store } = tempStore();
  let registerCode = "";
  let recoveryCode = "";
  try {
    const start = new Date("2026-09-20T00:00:00Z");
    await store.startRegistration("owner@example.com", async input => { registerCode = input.code; }, start);
    store.verifyRegistration(registerCode, new Date("2026-09-20T00:01:00Z"));
    await store.startRecovery("owner@example.com", async input => { recoveryCode = input.code; }, new Date("2026-09-20T00:02:01Z"));
    const result = store.verifyRecovery(recoveryCode, new Date("2026-09-20T00:03:00Z"));
    assert.equal(result.restrictedUntil, "2026-09-21T00:03:00.000Z");
    assert.throws(() => store.verifyRecovery(recoveryCode, new Date("2026-09-20T00:04:00Z")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("too many invalid recovery attempts invalidate pending code", async () => {
  const { dir, store } = tempStore();
  let code = "";
  try {
    const start = new Date("2026-09-20T00:00:00Z");
    await store.startRegistration("owner@example.com", async input => { code = input.code; }, start);
    for (let i = 0; i < 5; i += 1) {
      assert.throws(() => store.verifyRegistration("000000", new Date("2026-09-20T00:01:00Z")));
    }
    assert.throws(() => store.verifyRegistration(code, new Date("2026-09-20T00:02:00Z")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
