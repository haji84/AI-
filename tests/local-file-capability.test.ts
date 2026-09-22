import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileCapability } from "../src/orchestrator/local-file-capability.ts";
import type { WorkAction } from "../src/orchestrator/work-capability.ts";

function action(operation: string, path: string, text?: string): WorkAction {
  return {
    goalId: "g",
    jobId: "j",
    attemptId: "a",
    strategyId: "s",
    capability: "file.local",
    domain: "file",
    operation,
    input: { path, text },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: "file", required: true, spec: {} },
  };
}

test("local file adapter writes atomically, reads real bytes and blocks lexical traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-file-"));
  try {
    const capability = new LocalFileCapability(root);
    assert.equal(await capability.available(), true);

    const written = await capability.execute(action("write", "reports/a.txt", "hello"));
    assert.equal(written.ok, true);
    assert.equal(await readFile(join(root, "reports/a.txt"), "utf8"), "hello");
    assert.match(String(written.outputs.sha256), /^[a-f0-9]{64}$/);
    assert.equal((written.evidence[0]?.data as { sha256?: string } | undefined)?.sha256, written.outputs.sha256);

    const read = await capability.execute(action("read", "reports/a.txt"));
    assert.equal(read.ok, true);
    assert.equal(read.outputs.text, "hello");
    assert.equal(read.outputs.sha256, written.outputs.sha256);

    assert.equal((await capability.execute(action("write", "../escape.txt", "bad"))).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local file adapter fails closed on symlink escape for read and write", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-file-root-"));
  const outside = await mkdtemp(join(tmpdir(), "jarvis-file-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");

    const capability = new LocalFileCapability(root);
    const read = await capability.execute(action("read", "escape/secret.txt"));
    assert.equal(read.ok, false);
    assert.match(read.error ?? "", /escapes allowed root/);

    const write = await capability.execute(action("write", "escape/new.txt", "bad"));
    assert.equal(write.ok, false);
    assert.match(write.error ?? "", /symlink directory is not allowed/);
    await assert.rejects(readFile(join(outside, "new.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
