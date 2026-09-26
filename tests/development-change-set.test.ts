import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";

function changeSet() {
  return createDevelopmentChangeSet({
    changeSetId: "change-1",
    jobId: "job-681",
    workItemId: "job-681:implement",
    deviceId: "zbook",
    baseRevision: "a".repeat(40),
    changedPaths: ["src/example.ts"],
    affectedSymbols: ["Example"],
    patchDigest: "b".repeat(64),
    evidenceDigest: "c".repeat(64),
    rollback: { kind: "git-base", reference: "a".repeat(40) },
  }, new Date("2026-09-26T00:00:00.000Z"));
}

test("development Change Set binds immutable base, device, digests, and rollback", () => {
  const value = changeSet();
  assert.equal(value.status, "LOCAL");
  assert.equal(value.deviceId, "zbook");
  assert.equal(value.baseRevision, "a".repeat(40));
  assert.deepEqual(value.changedPaths, ["src/example.ts"]);
  assert.equal(value.rollback.reference, value.baseRevision);
});
test("development Change Set rejects traversal and secret-bearing metadata", () => {
  assert.throws(() => createDevelopmentChangeSet({
    ...changeSet(),
    changedPaths: ["../secret.txt"],
  }), /unsafe path/i);
  assert.throws(() => createDevelopmentChangeSet({
    ...changeSet(),
    affectedSymbols: ["password=super-secret-value"],
  }), /secret/i);
});

test("Change Set store survives restart and refuses identity mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-change-set-"));
  const path = join(directory, "changes.json");
  try {
    const first = new JsonFileDevelopmentChangeSetStore(path);
    await first.put(changeSet());
    const second = new JsonFileDevelopmentChangeSetStore(path);
    assert.deepEqual(await second.get("change-1"), changeSet());
    await assert.rejects(() => second.put({ ...changeSet(), jobId: "different" }), /identity conflict/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
