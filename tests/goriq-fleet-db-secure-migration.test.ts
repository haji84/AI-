import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/goriq-fleet-db-migration.mjs", import.meta.url);

function env(extra: Record<string,string>) {
  return { ...process.env, NODE_ENV: "test" as const, ...extra };
}

test("fleet DB migration seals a consistent snapshot and only the Mac private key can restore it", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-fleet-migration-"));
  const source = join(root, "source.db");
  const target = join(root, "target.db");
  const publicKey = join(root, "public.pem");
  const privateKey = join(root, "private.pem");
  const bundle = join(root, "fleet.sealed.json");

  const db = new DatabaseSync(source);
  db.exec(`
    CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const snapshot = {
    generatedAt: "2026-09-28T00:00:00.000Z",
    fleet: [{id:"secret-alpha",kind:"android"},{id:"secret-beta",kind:"android"}],
    tasks: []
  };
  db.prepare("INSERT INTO jarvis_state(id,payload,updated_at) VALUES(1,?,?)").run(JSON.stringify(snapshot), snapshot.generatedAt);
  for (const id of ["secret-alpha","secret-beta"]) {
    db.prepare("INSERT INTO jarvis_worker_identity(node_id,payload,updated_at) VALUES(?,?,?)")
      .run(id, JSON.stringify({nodeId:id}), snapshot.generatedAt);
  }
  db.close();

  await execFileAsync(process.execPath, [script.pathname, "keygen"], {
    env: env({
      GORIQ_MIGRATION_PUBLIC_KEY: publicKey,
      GORIQ_MIGRATION_PRIVATE_KEY: privateKey,
    }),
  });
  await chmod(privateKey, 0o600);

  await execFileAsync(process.execPath, [script.pathname, "seal"], {
    env: env({
      GORIQ_SOURCE_DB_PATH: source,
      GORIQ_MIGRATION_PUBLIC_KEY: publicKey,
      GORIQ_MIGRATION_BUNDLE: bundle,
      GORIQ_EXPECTED_FLEET_COUNT: "2",
      GORIQ_EXPECTED_IDENTITY_COUNT: "2",
    }),
  });

  const sealed = await readFile(bundle, "utf8");
  assert.equal(sealed.includes("secret-alpha"), false);
  assert.equal(sealed.includes("secret-beta"), false);

  await execFileAsync(process.execPath, [script.pathname, "unseal"], {
    env: env({
      GORIQ_MIGRATION_BUNDLE: bundle,
      GORIQ_MIGRATION_PRIVATE_KEY: privateKey,
      GORIQ_TARGET_DB_PATH: target,
      GORIQ_EXPECTED_FLEET_COUNT: "2",
      GORIQ_EXPECTED_IDENTITY_COUNT: "2",
    }),
  });

  const restored = new DatabaseSync(target, { readOnly: true });
  const state = restored.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as {payload:string};
  const identities = restored.prepare("SELECT COUNT(*) AS count FROM jarvis_worker_identity").get() as {count:number};
  restored.close();
  assert.equal(JSON.parse(state.payload).fleet.length, 2);
  assert.equal(identities.count, 2);
});

test("Mac runtime persists Broker and Compass state outside the repository", async () => {
  const source = await readFile(new URL("../scripts/jarvis-mac-runtime-entry.sh", import.meta.url), "utf8");
  assert.match(source, /JARVIS_DB_PATH/);
  assert.match(source, /JARVIS_COMPASS_DB_PATH/);
  assert.match(source, /STATE_ROOT.*state|state.*STATE_ROOT/);
});
