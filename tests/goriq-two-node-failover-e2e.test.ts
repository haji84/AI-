import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = "scripts/goriq-two-node-failover-e2e.ts";

function run(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, RUNNER_NAME: "test-runner" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("controlled failover advances epoch, preserves checkpoint, and fences stale owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "goriq-two-node-"));
  const evidence = join(dir, "evidence.json");
  try {
    run([
      "--phase", "prepare",
      "--dir", dir,
      "--origin", "macbook",
      "--target", "zbook",
      "--sha", "test-sha",
      "--lease-ms", "20",
    ]);
    run([
      "--phase", "resume",
      "--dir", dir,
      "--node", "zbook",
      "--sha", "test-sha",
      "--evidence", evidence,
    ]);
    const parsed = JSON.parse(await readFile(evidence, "utf8")) as {
      verdict: string;
      reclaimedTasks: number;
      tasks: Array<{
        migrationClass: string;
        oldEpoch: number;
        newEpoch: number;
        staleClaimRejected: boolean;
        checkpointPreserved: boolean;
      }>;
    };
    assert.equal(parsed.verdict, "PASS");
    assert.equal(parsed.reclaimedTasks, 2);
    assert.deepEqual(
      parsed.tasks.map((item) => item.migrationClass).sort(),
      ["MIGRATABLE", "RESTARTABLE"],
    );
    assert.ok(parsed.tasks.every((item) => item.newEpoch === item.oldEpoch + 1));
    assert.ok(parsed.tasks.every((item) => item.staleClaimRejected));
    assert.ok(parsed.tasks.every((item) => item.checkpointPreserved));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
