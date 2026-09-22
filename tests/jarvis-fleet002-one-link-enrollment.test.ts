import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OwnerInvitationStore } from "../src/jarvis/owner-invitation.ts";

function withInvitationStore(run: (store: OwnerInvitationStore, stateFile: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-fleet002-"));
  const stateFile = join(dir, "owner-invitation.json");
  try {
    run(new OwnerInvitationStore(stateFile), stateFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("FLEET-002 enrolls 100 unique device identities from one owner invitation", () => {
  withInvitationStore((store) => {
    const invitation = store.create(100);

    for (let index = 1; index <= 100; index += 1) {
      const nodeId = `device-${String(index).padStart(3, "0")}`;
      assert.doesNotThrow(() => store.consume(invitation.secret, nodeId));
    }

    const status = store.status();
    assert.equal(status.active, false);
    assert.equal(status.maxDevices, 100);
    assert.equal(status.usedDevices, 100);
    assert.equal(status.remaining, 0);
    assert.equal(status.revoked, false);
  });
});

test("FLEET-002 consume contract needs only the shared invitation and device self-identity", () => {
  withInvitationStore((store) => {
    const invitation = store.create(100);

    assert.equal(store.consume.length, 2);
    assert.doesNotThrow(() => store.consume(invitation.secret, "self-identified-device"));
    assert.equal(store.status().usedDevices, 1);
  });
});

test("FLEET-002 rejects duplicate identity and the 101st unique device fail-closed", () => {
  withInvitationStore((store) => {
    const invitation = store.create(100);

    store.consume(invitation.secret, "device-001");
    assert.throws(
      () => store.consume(invitation.secret, "device-001"),
      /Identity already used this invitation/,
    );
    assert.equal(store.status().usedDevices, 1);

    for (let index = 2; index <= 100; index += 1) {
      store.consume(invitation.secret, `device-${String(index).padStart(3, "0")}`);
    }

    assert.throws(
      () => store.consume(invitation.secret, "device-101"),
      /Invitation capacity reached/,
    );
    assert.equal(store.status().usedDevices, 100);
    assert.equal(store.status().remaining, 0);
  });
});

test("FLEET-002 persists capacity and duplicate-use state across store reload", () => {
  withInvitationStore((store, stateFile) => {
    const invitation = store.create(3);
    store.consume(invitation.secret, "device-a");
    store.consume(invitation.secret, "device-b");

    const reloaded = new OwnerInvitationStore(stateFile);
    assert.throws(
      () => reloaded.consume(invitation.secret, "device-a"),
      /Identity already used this invitation/,
    );
    reloaded.consume(invitation.secret, "device-c");
    assert.throws(
      () => reloaded.consume(invitation.secret, "device-d"),
      /Invitation capacity reached/,
    );
    assert.equal(reloaded.status().usedDevices, 3);
    assert.equal(reloaded.status().remaining, 0);
  });
});

test("FLEET-002 never exposes or persists the raw owner invitation secret", () => {
  withInvitationStore((store, stateFile) => {
    const invitation = store.create(100);
    const statusJson = JSON.stringify(store.status());
    const persisted = readFileSync(stateFile, "utf8");

    assert.ok(invitation.secret.startsWith("ji_"));
    assert.equal(statusJson.includes(invitation.secret), false);
    assert.equal(persisted.includes(invitation.secret), false);
    assert.equal(persisted.includes("\"digest\""), true);

    store.consume(invitation.secret, "device-001");
    const afterConsume = readFileSync(stateFile, "utf8");
    assert.equal(afterConsume.includes(invitation.secret), false);
  });
});
