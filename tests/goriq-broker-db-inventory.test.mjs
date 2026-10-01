import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

for (const override of [false, true]) {
  test(`Mac inventory finds persistent Broker state with ${override ? "configured" : "default"} root without exposing payload`, () => {
    const home = mkdtempSync(join(tmpdir(), "goriq-inventory-"));
    try {
      const state = override ? join(home, "custom-state") : join(home, ".goriq", "state");
      mkdirSync(state, { recursive: true });
      const db = new DatabaseSync(join(state, "jarvis.db"));
      db.exec("CREATE TABLE jarvis_state (id INTEGER, payload TEXT, updated_at TEXT); CREATE TABLE jarvis_worker_identity (id TEXT);");
      db.prepare("INSERT INTO jarvis_state VALUES (1, ?, ?)").run(JSON.stringify({ fleet: [{ id: "private-node-marker" }, { id: "other" }] }), "2026-10-01T06:00:00Z");
      db.exec("INSERT INTO jarvis_worker_identity VALUES ('a'), ('b'), ('c')");
      db.close();
      const child = spawnSync(process.execPath, ["--import", "data:text/javascript,Object.defineProperty(process,'platform',{value:'darwin'})", "scripts/goriq-broker-db-inventory.mjs"], {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, HOME: home, USERPROFILE: home, GORIQ_DB_CONFIGURED_PATH: "", GORIQ_STATE_ROOT: override ? state : "" },
        encoding: "utf8",
      });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout).candidates.find((candidate) => candidate.label === "mac-persistent-state");
      assert.ok(result, "canonical persistent DB must be inspected");
      assert.equal(result.exists, true);
      assert.equal(result.fleetCount, 2);
      assert.equal(result.workerIdentityCount, 3);
      assert.equal(result.snapshotUpdatedAt, "2026-10-01T06:00:00Z");
      assert.equal(result.error, null);
      assert.match(result.sha256, /^[a-f0-9]{64}$/);
      assert.equal(child.stdout.includes(home), false);
      assert.equal(child.stdout.includes("private-node-marker"), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
