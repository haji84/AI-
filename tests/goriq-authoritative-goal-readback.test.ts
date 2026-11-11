import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

test("authenticated Work Run readback is bound to the current Compass Goal across Broker restarts", { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-authority-readback-"));
  const compassPath = join(dir, "compass.sqlite");
  const db = new CompassStore(compassPath);
  const active = await new CompassGoalRegistryAdapter(db).create({
    title: "Preserve authorized development Goal identity",
    description: "Keep one current Compass Goal across restart",
    successCriteria: ["authorized Goal readback"], constraints: [],
  });
  const runs = new CompassWorkRunStore(db);
  await runs.put({ ...createQueuedWorkRun(active.goalId), phase: "HUMAN_GATE", blockers: ["approval_required"] });
  await runs.put({ ...createQueuedWorkRun("goal-obsolete-unbound"), phase: "COMPLETED" });
  const persistedJob = createDevelopmentJob({
    jobId: "fixture-current-development-job", goalId: active.goalId,
    requirementIds: ["CORE-014"], acceptanceCriteria: ["authorized Goal readback"],
    definitionOfDone: [{ id: "criterion-1", description: "authorized Goal readback", required: true }],
    baseRevision: "a".repeat(40),
    approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
    workItems: [{ id: "fixture-current-development-job:implement",
      objective: "Demonstrate current owner Job readback", dependsOn: [], requiredCapabilities: ["code-builder"] }],
  });
  await new JsonFileDevelopmentJobStore(join(dir, "self-development", "jobs.json")).put(persistedJob);
  db.close();

  try {
    for (let restart = 0; restart < 2; restart++) {
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], {
        env: {
          ...process.env, GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1",
          JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: "goal-authority-test",
          JARVIS_DB_PATH: join(dir, "state.sqlite"),
          JARVIS_COMPASS_DB_PATH: compassPath, JARVIS_PUBLIC_BROKER_URL: "",
          JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "",
        },
        stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
      });
      let stderr = "";
      child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
      try {
        let ready = false;
        for (let n = 0; n < 150; n++) {
          try {
            if ((await fetch(url + "/health", { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; }
          } catch { /* bounded startup poll */ }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(ready, true, `Broker failed to start: ${stderr}`);
        const currentUrl = `${url}/api/jarvis/admin/work/${encodeURIComponent(active.goalId)}`;
        const staleUrl = `${url}/api/jarvis/admin/work/goal-obsolete-unbound`;
        assert.equal((await fetch(currentUrl)).status, 401, "untrusted reader must not see Work Runs");
        const headers = { Authorization: "Bearer goal-authority-test" };
        const current = await fetch(currentUrl, { headers });
        assert.equal(current.status, 200);
        const body = await current.json() as {
          run: { goalId: string; phase: string };
          goalAuthority?: { kind: string; goalId: string; current: boolean };
        };
        assert.equal(body.run.goalId, active.goalId);
        assert.equal(body.run.phase, "HUMAN_GATE", "readback never grants execution approval");
        assert.deepEqual(body.goalAuthority, {
          kind: "CURRENT_COMPASS_GOAL", goalId: active.goalId, current: true,
        }, "only the current canonical Goal can be reported as authoritative");
        const readback = body as unknown as {
          jobReadback?: {
            kind: string; goalId: string; goalDigest: string | null;
            remoteAuthorityVerified: boolean;
            jobs: { jobId: string; phase: string; recordSha256: string;
              approvalScope: { taskScopeId: string; maxRisk: string } }[];
          };
        };
        assert.equal(readback.jobReadback?.kind, "LOCAL_PERSISTED_JOBS");
        assert.equal(readback.jobReadback?.goalId, active.goalId);
        assert.equal(readback.jobReadback?.goalDigest, residentDevelopmentGoalDigest(active.goal));
        assert.equal(readback.jobReadback?.remoteAuthorityVerified, false,
          "a same-host reader cannot claim cross-host consensus");
        assert.deepEqual(readback.jobReadback?.jobs, [{
          jobId: persistedJob.jobId, phase: persistedJob.phase,
          recordSha256: createHash("sha256").update(JSON.stringify(persistedJob)).digest("hex"),
          approvalScope: { taskScopeId: "issue:1219", maxRisk: "low" },
        }], "Job scope and exact stored bytes must match current Goal without leaking instructions");

        const stale = await fetch(staleUrl, { headers });
        assert.equal(stale.status, 200, "owner may review historical notices and evidence");
        const historical = await stale.json() as {
          run: { goalId: string; phase: string };
          goalAuthority: { kind: string; goalId: string; current: boolean };
        };
        assert.equal(historical.run.phase, "COMPLETED");
        assert.deepEqual(historical.goalAuthority, {
          kind: "HISTORICAL_WORK_RUN", goalId: "goal-obsolete-unbound", current: false,
        }, "historical record cannot authorize a current Goal");
        assert.equal((historical as unknown as { jobReadback?: { kind: string } })
          .jobReadback?.kind, "HISTORICAL_ONLY");
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill();
          await exited;
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
