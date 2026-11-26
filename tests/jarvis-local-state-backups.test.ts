import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { JarvisControlPlane, JarvisSqliteStateStore } from "../src/jarvis/index.ts";
import { CompassStore } from "../src/compass/store.ts";

async function adapter() {
  assert.ok(existsSync(new URL("../src/jarvis/local-state-backups.ts", import.meta.url)), "product managed backup adapter is missing");
  return import("../src/jarvis/local-state-backups.ts");
}

async function fixture(run: (paths: { brokerPath: string; compassPath: string }, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "local-state-backup-"));
  const paths = { brokerPath: join(directory, "broker.sqlite"), compassPath: join(directory, "compass.sqlite") };
  const broker = new JarvisSqliteStateStore(paths.brokerPath);
  const plane = new JarvisControlPlane();
  const snapshot = plane.snapshot();
  snapshot.generatedAt = "2026-11-05T00:00:00.000Z";
  broker.save(snapshot);
  const db = new DatabaseSync(paths.brokerPath);
  db.prepare("UPDATE jarvis_state SET payload = ? WHERE id = 1").run(JSON.stringify({ ...snapshot, publicTask: "PUBLIC_TASK_PAYLOAD_CANARY_681" }));
  db.close(); broker.close();
  const compass = new CompassStore(paths.compassPath);
  compass.setGoal({ title: "PUBLIC_GOAL_PAYLOAD_CANARY_681", successCriteria: ["public fixture only"] });
  compass.close();
  try { await run(paths, directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("managed backup persists two actual SQLite stores and verifies fresh isolated copies without activation", async () => {
  const { LocalStateBackups } = await adapter();
  await fixture(async (paths) => {
    const before = await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]);
    const manager = new LocalStateBackups(paths);
    const initial = await manager.list();
    assert.equal(initial.capability.available, process.platform !== "win32");
    if (process.platform === "win32") { assert.equal(initial.capability.reason, "private_storage_unsupported"); return; }
    assert.deepEqual(initial.coverage.included, ["broker-sqlite", "compass-sqlite"]);
    assert.ok(initial.coverage.excluded.includes("pc-task-json"));
    assert.equal(initial.coverage.consistency, "per-store");
    const created = await manager.create();
    assert.match(created.id, /^[a-f0-9-]{36}$/);
    assert.equal(created.stores.length, 2);
    assert.equal(created.status, "ready");
    const restarted = new LocalStateBackups(paths);
    assert.equal((await restarted.list()).generations[0].id, created.id);
    const verified = await restarted.verify(created.id);
    assert.equal(verified.status, "verified");
    assert.equal(verified.activationAuthorized, false);
    const generation = join(paths.brokerPath + ".state-backups", created.id);
    const drill = (await readdir(generation)).find(name => name.startsWith("drill-"));
    assert.ok(drill);
    const restoredBroker = new DatabaseSync(join(generation, drill, "broker.sqlite"), { readOnly: true });
    const restoredCompass = new DatabaseSync(join(generation, drill, "compass.sqlite"), { readOnly: true });
    try {
      assert.equal(JSON.parse(String(restoredBroker.prepare("SELECT payload FROM jarvis_state WHERE id=1").get()?.payload)).publicTask, "PUBLIC_TASK_PAYLOAD_CANARY_681");
      assert.equal(restoredCompass.prepare("SELECT title FROM goal WHERE id=1").get()?.title, "PUBLIC_GOAL_PAYLOAD_CANARY_681");
    } finally { restoredBroker.close(); restoredCompass.close(); }
    assert.deepEqual(await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]), before);
    const publicText = JSON.stringify(await restarted.list());
    assert.doesNotMatch(publicText, /PUBLIC_.*PAYLOAD_CANARY|broker\.sqlite|compass\.sqlite|\/tmp\/|backupPath|restoredPath/);
    for (const dir of [paths.brokerPath + ".state-backups", generation, join(generation, drill)]) {
      assert.equal((await lstat(dir)).mode & 0o777, 0o700);
      for (const name of await readdir(dir)) {
        const info = await lstat(join(dir, name));
        if (info.isFile()) assert.equal(info.mode & 0o777, 0o600);
      }
    }
  });
});

test("managed operations reject arbitrary authority, unknown IDs, missing configured sources and do not create them", async () => {
  const { LocalStateBackups, parseLocalStateBackupCommand } = await adapter();
  for (const payload of [null, [], { operation: "create", path: "/tmp/private" }, { operation: "create", url: "https://example.com" }, { operation: "verify", generationId: "../" }, { operation: "activate" }, { operation: "create", sql: "select 1" }, { operation: "create", upload: "anything" }]) {
    assert.throws(() => parseLocalStateBackupCommand(payload), /invalid_request/);
  }
  assert.deepEqual(parseLocalStateBackupCommand({ operation: "create" }), { operation: "create" });
  await fixture(async paths => {
    const manager = new LocalStateBackups(paths);
    await assert.rejects(manager.verify("00000000-0000-4000-8000-000000000000"), /generation_not_found/);
    await rm(paths.compassPath);
    await assert.rejects(manager.create(), /source_unavailable/);
    assert.equal(existsSync(paths.compassPath), false);
  });
});

test("managed storage fails closed on symlinks, unsafe preexisting modes, and conflicting operation lock", { skip: process.platform === "win32" }, async () => {
  const { LocalStateBackups } = await adapter();
  await fixture(async (paths, directory) => {
    const root = paths.brokerPath + ".state-backups";
    await mkdir(root, { mode: 0o755 });
    await chmod(root, 0o755); // Make the unsafe fixture explicit even under a restrictive host umask.
    await assert.rejects(new LocalStateBackups(paths).create(), /unsafe_storage/);
    assert.equal((await lstat(root)).mode & 0o777, 0o755, "never changes existing protections");
    await rm(root, { recursive: true });
    await symlink(directory, root);
    await assert.rejects(new LocalStateBackups(paths).create(), /unsafe_storage/);
    await rm(root);
    const manager = new LocalStateBackups(paths);
    await manager.create();
    await mkdir(join(root, ".operation"), { mode: 0o700 });
    await assert.rejects(manager.create(), /operation_busy/);
    await rm(join(root, ".operation"), { recursive: true });
    await rm(paths.compassPath);
    await symlink(paths.brokerPath, paths.compassPath);
    await assert.rejects(manager.create(), /unsafe_storage/);
  });
});

test("catalogued backup rejects payload and metadata tampering, symlink artifacts, and enforces no auto-delete limits", { skip: process.platform === "win32" }, async () => {
  const { LocalStateBackups } = await adapter();
  await fixture(async paths => {
    const manager = new LocalStateBackups(paths), created = await manager.create();
    const generation = join(paths.brokerPath + ".state-backups", created.id);
    const backup = join(generation, "broker.sqlite"), original = await readFile(backup);
    await writeFile(backup, Buffer.alloc(original.length, 65));
    await assert.rejects(manager.verify(created.id), /verification_failed/);
    await writeFile(backup, original);
    await rm(backup); await symlink(paths.brokerPath, backup);
    await assert.rejects(manager.verify(created.id), /unsafe_storage/);
    await rm(backup); await writeFile(backup, original, { mode: 0o600 });
    const summaryPath = join(generation, "generation.json"), summary = await readFile(summaryPath, "utf8");
    await writeFile(summaryPath, JSON.stringify({ ...JSON.parse(summary), sourcePath: "/private/canary" }));
    await assert.rejects(manager.verify(created.id), /catalog_invalid/);
    await writeFile(summaryPath, summary);
    for (let n = 0; n < 8; n++) await manager.verify(created.id);
    await assert.rejects(manager.verify(created.id), /resource_limit/);
    assert.deepEqual(await readFile(backup), original);
    await chmod(summaryPath, 0o644);
    assert.equal((await manager.list()).capability.available, false);
    assert.equal((await lstat(summaryPath)).mode & 0o777, 0o644);
  });
});

// Pause inside the actual adapter's acquired critical section; never substitute a backup result.
let holderSequence = 0;
async function lockHolder(paths: { brokerPath: string; compassPath: string }) {
  const script = `
    const {LocalStateBackups}=await import(process.argv[2]);
    const manager=new LocalStateBackups(JSON.parse(process.argv[3]));
    const sources=manager.sources.bind(manager);
    manager.sources=async()=>{
      process.send({phase:"held"});
      await new Promise(resolve=>process.once("message",message=>{if(message==="release")resolve();}));
      return sources();
    };
    try {const generation=await manager.create();process.send({phase:"complete",id:generation.id});}
    catch(error){process.send({phase:"rejected",code:error.code??error.message});}
    process.disconnect();
  `;
  const childScript = paths.brokerPath + `.lock-holder-${++holderSequence}.mjs`;
  await writeFile(childScript, script, { flag: "wx", mode: 0o600 });
  const child = spawn(process.execPath, [childScript, new URL("../src/jarvis/local-state-backups.ts", import.meta.url).href, JSON.stringify(paths)], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const messages: Array<{ phase: string; code?: string; id?: string }> = [];
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += chunk; });
  child.on("message", value => messages.push(value as typeof messages[number]));
  async function waitFor(phases: string[]) {
    const limit = Date.now() + 5000;
    while (Date.now() < limit) {
      const found = messages.find(message => phases.includes(message.phase));
      if (found) return found;
      assert.equal(child.exitCode, null, "owned lock holder exited before its actual critical-section barrier: " + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("owned lock holder did not report its actual critical section");
  }
  return { child, waitFor };
}
async function stopHolder(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
}

test("actual native operation lock rejects a live contender and releases after the owned holder dies", { skip: process.platform === "win32", timeout: 20000 }, async () => {
  const { LocalStateBackups } = await adapter();
  await fixture(async paths => {
    const before = await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]);
    const generation = await new LocalStateBackups(paths).create();
    const holder = await lockHolder(paths);
    try {
      assert.equal((await holder.waitFor(["held", "rejected"])).phase, "held");
      await assert.rejects(new LocalStateBackups(paths).create(), /operation_busy/);
      await assert.rejects(new LocalStateBackups(paths).verify(generation.id), /operation_busy/);
      await stopHolder(holder.child);
      assert.equal(holder.child.signalCode, "SIGKILL");
      let recovered = generation;
      await assert.doesNotReject(async () => { recovered = await new LocalStateBackups(paths).create(); }, "a dead holder cannot strand future operations");
      assert.equal(recovered.status, "ready", "a dead holder cannot strand all future operations");
      assert.equal((await new LocalStateBackups(paths).verify(generation.id)).status, "verified");
      const lockPath = join(paths.brokerPath + ".state-backups", ".operation.sqlite");
      assert.ok(existsSync(lockPath), "native coordination file is missing");
      const lock = await lstat(lockPath);
      assert.equal(lock.isFile(), true); assert.equal(lock.mode & 0o777, 0o600); assert.equal(lock.size, 0);
      const inode = lock.ino;
      await new LocalStateBackups(paths).verify(recovered.id);
      assert.equal((await lstat(lockPath)).ino, inode, "never unlinks/replaces a native lock inode");
      assert.equal(existsSync(join(paths.brokerPath + ".state-backups", ".operation")), false);
      const listed = await new LocalStateBackups(paths).list();
      assert.equal(listed.capability.available, true); assert.equal(listed.generations.length, 2);
      assert.deepEqual(await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]), before);
    } finally { await stopHolder(holder.child); }
  });
});

test("two actual simultaneous processes admit one native operation holder and preserve the control inode", { skip: process.platform === "win32", timeout: 20000 }, async () => {
  const { LocalStateBackups } = await adapter();
  await fixture(async paths => {
    await new LocalStateBackups(paths).create();
    const holders = await Promise.all([lockHolder(paths), lockHolder(paths)]);
    try {
      const results = await Promise.all(holders.map(holder => holder.waitFor(["held", "rejected"])));
      assert.deepEqual(results.map(result => result.phase).sort(), ["held", "rejected"]);
      assert.equal(results.find(result => result.phase === "rejected")?.code, "operation_busy");
      const winner = holders[results.findIndex(result => result.phase === "held")];
      winner.child.send("release");
      assert.equal((await winner.waitFor(["complete", "rejected"])).phase, "complete");
      const lockPath = join(paths.brokerPath + ".state-backups", ".operation.sqlite");
      assert.ok(existsSync(lockPath), "native coordination file is missing");
      assert.equal((await lstat(lockPath)).size, 0);
      assert.equal((await new LocalStateBackups(paths).list()).generations.length, 2);
    } finally { await Promise.all(holders.map(holder => stopHolder(holder.child))); }
  });
});

test("unsafe existing native control files are refused and preserved without mode repair or unlink", { skip: process.platform === "win32" }, async () => {
  const { LocalStateBackups } = await adapter();
  for (const kind of ["symlink", "hardlink", "unsafe-mode", "oversized", "directory"]) {
    await fixture(async (paths, directory) => {
      const root = paths.brokerPath + ".state-backups", lockPath = join(root, ".operation.sqlite"), target = join(directory, "public-control-target");
      await mkdir(root, { mode: 0o700 });
      await writeFile(target, "public-owned-target", { mode: 0o600 });
      if (kind === "symlink") await symlink(target, lockPath);
      else if (kind === "hardlink") await link(target, lockPath);
      else if (kind === "directory") await mkdir(lockPath, { mode: 0o700 });
      else { await writeFile(lockPath, kind === "oversized" ? "X".repeat(8193) : "", { mode: 0o600 }); if (kind === "unsafe-mode") await chmod(lockPath, 0o644); }
      const before = await lstat(lockPath);
      await assert.rejects(new LocalStateBackups(paths).create(), /unsafe_storage/, kind);
      const listed = await new LocalStateBackups(paths).list();
      assert.equal(listed.capability.available, false, kind); assert.equal(listed.capability.reason, "unsafe_storage", kind);
      const after = await lstat(lockPath);
      assert.equal(after.ino, before.ino, kind); assert.equal(after.mode, before.mode, kind); assert.equal(after.size, before.size, kind);
      assert.equal(await readFile(target, "utf8"), "public-owned-target");
    });
  }
});
