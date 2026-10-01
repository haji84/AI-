import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  DurableTaskRuntime, JsonFileDurableTaskStore, MemoryDurableTaskStore,
  type DurableTaskStore,
} from "../src/gai/durable-task-runtime.ts";

const now = new Date("2026-10-01T10:00:00Z");
const input = (id: string) => ({ id, idempotencyKey: id, type: "work" });

for (const kind of ["memory", "json"] as const) {
  async function fixture(run: (store: DurableTaskStore, other: DurableTaskStore) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "durable-cas-"));
    const store = kind === "memory" ? new MemoryDurableTaskStore() : new JsonFileDurableTaskStore(join(dir, "tasks.json"));
    const other = kind === "memory" ? store : new JsonFileDurableTaskStore(join(dir, "tasks.json"));
    try { await run(store, other); } finally { await rm(dir, { recursive: true, force: true }); }
  }

  test(`${kind}: old live claim cannot mutate a task taken over by another runtime`, async () => {
    await fixture(async (store, other) => {
      const old = new DurableTaskRuntime(store);
      await old.enqueue(input("takeover"), now);
      const claim = await old.leaseClaim("takeover", "mac", 60_000, now);
      await old.markRunningClaimed(claim, now);
      const replacement = new DurableTaskRuntime(other);
      await replacement.recoverOrphans(new Set(), now);
      const next = await replacement.leaseClaim("takeover", "zbook", 60_000, now);
      assert.equal(next.epoch, 2);
      const mutations = [
        () => old.completeClaimed(claim, "late", now),
        () => old.heartbeatClaimed(claim, 60_000, now),
        () => old.setCheckpointRefClaimed(claim, "late-checkpoint", now),
        () => old.failClaimed(claim, "late-error", 0, now),
        () => old.readyToPublishClaimed(claim, "late-publication", now),
        () => old.markRunningClaimed(claim, now),
      ];
      for (const mutation of mutations) await assert.rejects(mutation, /STALE_EXECUTION_CLAIM/);
      assert.equal((await old.get("takeover"))?.leaseOwner, "zbook");
      await replacement.completeClaimed(next, "verified", now);
      assert.equal((await old.get("takeover"))?.result, "verified");
    });
  });

  test(`${kind}: concurrent leases return only one successful execution claim`, async () => {
    await fixture(async (store, other) => {
      const a = new DurableTaskRuntime(store);
      const b = new DurableTaskRuntime(other);
      await a.enqueue(input("race"), now);
      const results = await Promise.allSettled([
        a.leaseClaim("race", "mac", 60_000, now), b.leaseClaim("race", "zbook", 60_000, now),
      ]);
      const winners = results.filter(r => r.status === "fulfilled");
      assert.equal(winners.length, 1);
      const winner = winners[0];
      assert.equal(winner.status, "fulfilled");
      if (winner.status === "fulfilled") {
        assert.equal((await b.get("race"))?.fencingToken, winner.value.fencingToken);
        assert.equal((await a.get("race"))?.executionEpoch, 1);
      }
    });
  });

  test(`${kind}: concurrent enqueues never silently lose successful work`, async () => {
    await fixture(async (store, other) => {
      const a = new DurableTaskRuntime(store), b = new DurableTaskRuntime(other);
      const results = await Promise.allSettled([a.enqueue(input("a"), now), b.enqueue(input("b"), now)]);
      const persisted = new Set((await new DurableTaskRuntime(other).list()).map(t => t.id));
      for (const result of results) if (result.status === "fulfilled") assert.ok(persisted.has(result.value.id));
      for (const id of ["a", "b"]) if (!persisted.has(id)) await a.enqueue(input(id), now);
      assert.deepEqual((await b.list()).map(t => t.id).sort(), ["a", "b"]);
    });
  });

  test(`${kind}: takeover between read and commit fences the delayed old completion`, async () => {
    await fixture(async (store, other) => {
      let release!: () => void, entered!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const reached = new Promise<void>(resolve => { entered = resolve; });
      let pause = false;
      const delayed: DurableTaskStore = {
        load: () => store.load(), save: snapshot => store.save(snapshot),
        compareAndSwap: async (expected, next) => {
          if (pause) { entered(); await blocked; }
          return store.compareAndSwap!(expected, next);
        },
      };
      const old = new DurableTaskRuntime(delayed);
      await old.enqueue(input("delayed"), now);
      const claim = await old.leaseClaim("delayed", "mac", 60_000, now);
      pause = true;
      const completion = old.completeClaimed(claim, "late", now);
      const rejection = assert.rejects(completion, /DURABLE_TASK_STORE_CONFLICT/);
      try {
        await reached;
        const replacement = new DurableTaskRuntime(other);
        await replacement.recoverOrphans(new Set(), now);
        const next = await replacement.leaseClaim("delayed", "zbook", 60_000, now);
        release();
        await rejection;
        assert.equal((await old.get("delayed"))?.fencingToken, next.fencingToken);
        await replacement.completeClaimed(next, "verified", now);
        assert.equal((await old.get("delayed"))?.result, "verified");
      } finally { release(); }
    });
  });
}

test("JSON CAS arbitrates actual separate writer processes", { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "durable-process-"));
  const path = join(dir, "tasks.json");
  await new DurableTaskRuntime(new JsonFileDurableTaskStore(path)).enqueue(input("process"), now);
  const source = new URL("../src/gai/durable-task-runtime.ts", import.meta.url).href;
  const children = ["mac", "zbook"].map(owner => {
    const script = `import {DurableTaskRuntime, JsonFileDurableTaskStore} from ${JSON.stringify(source)};
const store = new JsonFileDurableTaskStore(process.argv[1]);
let first = true;
const proxy = {load: async () => {
  const snapshot = await store.load();
  if(first) {first=false; process.stdout.write('READY\\n'); await new Promise(resolve => process.stdin.once('data', resolve));}
  return snapshot;
}, save: s => store.save(s), compareAndSwap: (e,n) => store.compareAndSwap(e,n)};
try { const claim = await new DurableTaskRuntime(proxy).leaseClaim('process', process.argv[2], 60000, new Date(${JSON.stringify(now.toISOString())})); process.stdout.write(JSON.stringify({claim})+'\\n'); }
catch(error) {process.stdout.write(JSON.stringify({error:error.message})+'\\n');}
process.stdin.destroy();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, path, owner], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "";
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("READY\n")) resolve(); });
      child.once("error", reject);
      child.once("exit", () => { if (!output.includes("READY\n")) reject(new Error(errors || "writer exited before ready")); });
    });
    child.stderr.on("data", chunk => { errors += chunk; });
    const finished = new Promise<{ claim?: { fencingToken: string }; error?: string }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => {
        if (code !== 0) { reject(new Error(errors)); return; }
        try { resolve(JSON.parse(output.trim().split("\n").at(-1)!)); } catch(error) { reject(error); }
      });
    });
    return { child, ready, finished };
  });
  try {
    await Promise.all(children.map(c => c.ready));
    for (const c of children) c.child.stdin.end("continue\n");
    const results = await Promise.all(children.map(c => c.finished));
    const winners = results.filter(r => r.claim);
    assert.equal(winners.length, 1);
    assert.match(results.find(r => r.error)?.error ?? "", /DURABLE_TASK_STORE_CONFLICT/);
    assert.equal((await new DurableTaskRuntime(new JsonFileDurableTaskStore(path)).get("process"))?.fencingToken, winners[0].claim?.fencingToken);
  } finally {
    for (const c of children) if (c.child.exitCode === null) c.child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("one runtime isolates simultaneous public operations", async () => {
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const results = await Promise.allSettled([runtime.enqueue(input("a"), now), runtime.enqueue(input("b"), now)]);
  const ids = new Set((await runtime.list()).map(t => t.id));
  for (const result of results) if (result.status === "fulfilled") assert.ok(ids.has(result.value.id));
  assert.equal(results.filter(r => r.status === "fulfilled").length, ids.size);
});

test("next persists dependency failure after nested lease expiry recovery", async () => {
  const store = new MemoryDurableTaskStore();
  const runtime = new DurableTaskRuntime(store);
  await runtime.enqueue({ ...input("parent"), maxAttempts: 1 }, now);
  await runtime.enqueue({ ...input("dependent"), dependsOn: ["parent"] }, now);
  await runtime.leaseClaim("parent", "mac", 1, now);
  assert.equal(await runtime.next(new Date(now.getTime() + 2)), undefined);
  assert.equal((await runtime.get("dependent"))?.status, "failed");
  assert.equal((await new DurableTaskRuntime(store).get("dependent"))?.status, "failed");
});

test("mutation through a store without atomic support fails visibly without saving", async () => {
  let saved = false;
  const runtime = new DurableTaskRuntime({ load: async () => null, save: async () => { saved = true; } });
  await assert.rejects(() => runtime.enqueue(input("unsupported"), now), /DURABLE_TASK_ATOMIC_STORE_REQUIRED/);
  assert.equal(saved, false);
});
