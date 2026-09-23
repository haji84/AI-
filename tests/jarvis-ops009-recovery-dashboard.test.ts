import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL } from "node:url";

import { readJarvisRecoveryDashboard } from "../src/jarvis/recovery-dashboard.ts";

async function recoveryFile() {
  return join(await mkdtemp(join(tmpdir(), "jarvis-recovery-dashboard-")), "runs.json");
}

test("OPS-009 shows active recovery status and blocker from durable state without raw evidence", async () => {
  const path = await recoveryFile();
  const secretEvidence = "raw-execution-evidence-must-not-leak";
  await writeFile(path, `${JSON.stringify({
    version: 1,
    runs: [
      {
        runId: "completed-run",
        goal: { title: "already complete" },
        state: "completed",
        updatedAt: "2026-09-21T12:00:00.000Z",
        recoveryHistory: [],
      },
      {
        runId: "active-run",
        goal: { title: "recover active task" },
        state: "blocked",
        updatedAt: "2026-09-21T12:05:00.000Z",
        completionEvidence: [{ secretEvidence }],
        recoveryBudget: { blockedReason: "Durable non-progress budget exhausted" },
        journal: { nextAction: "Wait for explicit blocker resolution" },
        recoveryHistory: [{
          cycle: 3,
          observedAt: "2026-09-21T12:04:00.000Z",
          action: "blocked",
          reason: "same failure reached durable limit",
          blocked: true,
          nextStrategyPivot: 1,
          actionId: "blocked-3",
          actionDescription: "blocked action",
          nextAction: "BLOCKED: durable limit",
          evidence: { secretEvidence },
          humanInterventionHint: "do not expose me",
        }],
      },
    ],
  })}\n`, "utf8");

  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.state, "blocked");
  assert.equal(report.runId, "active-run");
  assert.equal(report.goalTitle, "recover active task");
  assert.equal(report.cycle, 3);
  assert.equal(report.recoveryAction, "blocked");
  assert.equal(report.blocker, "Durable non-progress budget exhausted");
  assert.equal(report.nextAction, "BLOCKED: durable limit");
  assert.equal(JSON.stringify(report).includes(secretEvidence), false);
  assert.equal(JSON.stringify(report).includes("humanInterventionHint"), false);
});

test("OPS-009 distinguishes recovering, waiting, idle and unknown without inventing success", async () => {
  const recoveringPath = await recoveryFile();
  await writeFile(recoveringPath, `${JSON.stringify({
    version: 1,
    runs: [{
      runId: "repair-run",
      goal: { title: "repair task" },
      state: "running",
      updatedAt: "2026-09-21T12:10:00.000Z",
      recoveryHistory: [{
        cycle: 2,
        observedAt: "2026-09-21T12:09:00.000Z",
        action: "repair",
        reason: "verification failed; repair current strategy",
        blocked: false,
        nextStrategyPivot: 0,
        actionId: null,
        actionDescription: null,
        nextAction: "repair and retry",
      }],
    }],
  })}\n`, "utf8");
  assert.equal((await readJarvisRecoveryDashboard(recoveringPath)).state, "recovering");

  const waitingPath = await recoveryFile();
  await writeFile(waitingPath, `${JSON.stringify({
    version: 1,
    runs: [{
      runId: "gate-run",
      goal: { title: "human gate" },
      state: "approval-required",
      updatedAt: "2026-09-21T12:11:00.000Z",
      recoveryHistory: [],
    }],
  })}\n`, "utf8");
  const waiting = await readJarvisRecoveryDashboard(waitingPath);
  assert.equal(waiting.state, "blocked");
  assert.equal(waiting.blocker, "Human Gate pending");

  const idlePath = await recoveryFile();
  await writeFile(idlePath, `${JSON.stringify({
    version: 1,
    runs: [{
      runId: "done-run",
      goal: { title: "done" },
      state: "completed",
      updatedAt: "2026-09-21T12:12:00.000Z",
      recoveryHistory: [],
    }],
  })}\n`, "utf8");
  assert.equal((await readJarvisRecoveryDashboard(idlePath)).state, "idle");

  const missingPath = await recoveryFile();
  const missing = await readJarvisRecoveryDashboard(missingPath);
  assert.equal(missing.state, "unknown");
  assert.match(missing.detail, /not been observed/i);
});

test("OPS-009 fails closed on malformed durable recovery state", async () => {
  const path = await recoveryFile();
  await writeFile(path, `${JSON.stringify({
    version: 1,
    runs: [{
      runId: "bad-run",
      goal: { title: "bad state" },
      state: "running",
      updatedAt: "not-a-date",
      recoveryHistory: [],
    }],
  })}\n`, "utf8");

  await assert.rejects(() => readJarvisRecoveryDashboard(path), /invalid production recovery dashboard file/);
});

test("OPS-009 route is owner-gated, read-only, no-store and does not expose persistence paths", async () => {
  const routeSource = await readFile(new URL("../src/app/api/jarvis/recovery/route.ts", import.meta.url), "utf8");

  assert.match(routeSource, /requireJarvisOwner\(\)/);
  assert.match(routeSource, /Cache-Control.*no-store/);
  assert.match(routeSource, /JARVIS_PRODUCTION_RUNS_FILE/);
  assert.match(routeSource, /readJarvisRecoveryDashboard\(filePath\)/);
  assert.doesNotMatch(routeSource, /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(routeSource, /NextResponse\.json\([^\n]*filePath/);
  assert.doesNotMatch(routeSource, /execFile|spawn|child_process|Set-ScheduledTask|Register-ScheduledTask|schtasks/i);
});

test("OPS-009 owner-facing page is linked and contains no recovery execution controls", async () => {
  const pageSource = await readFile(new URL("../src/app/jarvis/recovery/page.tsx", import.meta.url), "utf8");
  const jarvisPage = await readFile(new URL("../src/app/jarvis/page.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /fetch\("\/api\/jarvis\/recovery", \{ cache: "no-store" \}\)/);
  assert.match(pageSource, /GORIQ RECOVERY DASHBOARD/);
  assert.match(pageSource, /ここから復旧操作は実行しません/);
  assert.match(pageSource, /Blocker/);
  assert.doesNotMatch(pageSource, /fetch\([^\n]+method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(pageSource, /再実行|復旧開始|resume|trigger recovery/i);
  assert.match(jarvisPage, /tools\.map\(item=><a key=\{item\.href\} href=\{item\.href\}/);
  assert.match(jarvisPage, /href:"\/jarvis\/recovery",label:"復旧状況"/);
});
