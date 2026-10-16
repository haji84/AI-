import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { assessAutonomyLock } from "../src/orchestrator/autonomy-lock-assessment.ts";
import { CompassStore } from "../src/compass/store.ts";
import { DurableTaskRuntime, JsonFileDurableTaskStore, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { RuntimeDevelopmentPlanner } from "../src/orchestrator/runtime-development-planner.ts";
import { createCodeBuilderCapability, createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal, durableClaimWriteAuthority } from "../src/orchestrator/compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { selectIndependentWorkItem } from "../src/orchestrator/work-state.ts";
import { type ContextSource, type Verifier } from "../src/orchestrator/goal-loop.ts";
import { createWorkStateIntegratedGoalLoop, goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const resumeOnly = args.has("--resume-only");
const maxCyclesArg = process.argv.find((value) => value.startsWith("--max-cycles="));
// Each invocation is bounded; unfinished Goals must resume via durable state, not a fixed retry count.
const maxCycles = maxCyclesArg ? Number(maxCyclesArg.split("=")[1]) : 1;
if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 20) {
  throw new Error("max-cycles must be an integer from 1 to 20");
}
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db");
const recoveryActionId = process.env.AUTONOMY_RECOVERY_ACTION_ID?.trim();
const sqliteFenced = process.env.AUTONOMY_COMPASS_SQLITE_FENCE === "1";

// Atomic exclusive lock. A crash leaves the lock in place until reconciled.
const lockPath = dbPath + ".autonomy-lock";
const lockOwnerPath = resolve(lockPath, "owner.json");
const runId = randomUUID();
// Never release a lock whose ownership metadata has changed.
function releaseOwnedLock(): void {
  let owner: unknown;
  try { owner = JSON.parse(readFileSync(lockOwnerPath, "utf8")); }
  catch { return; }
  if (!owner || typeof owner !== "object" || (owner as Record<string, unknown>).runId !== runId) return;
  rmSync(lockPath, { recursive: true, force: true });
}
mkdirSync(dirname(lockPath), { recursive: true });
try {
  mkdirSync(lockPath);

} catch (error) {
  const assessment = assessAutonomyLock(lockPath);
  throw new Error(`autonomy already locked (${assessment}); reconcile previous run before retry`, { cause: error });
}
try {
  writeFileSync(lockOwnerPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname(), runId }) + "\n", { flag: "wx", mode: 0o600 });
} catch (error) {
  releaseOwnedLock();
  throw error;
}
let compass: CompassStore | null = null;
try {
  compass = new CompassStore(dbPath, { readOnly: dryRun });
  const persistedGoal = compass.getGoal();
  const persistedState = compass.getState();
  const sourceRecoveryDecision = dryRun && sqliteFenced && recoveryActionId && persistedGoal
    ? compass.executionLease({ initialize: false }).recoveryDecision(goalWorkStateId(compassGoalToLoopGoal(persistedGoal)), recoveryActionId) : null;
  if (dryRun) {
    const source = compass;
    source.close();
    compass = new CompassStore(":memory:");
    if (persistedGoal) compass.setGoal(persistedGoal);
    compass.updateState(persistedState);
  }
  const activeCompass = compass;
  const goalRecord = activeCompass.getGoal();
  if (!goalRecord) throw new Error("Compass goal is not set");
  const goal = compassGoalToLoopGoal(goalRecord);
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const currentState = activeCompass.getState();
  const checkpointPath: string = process.env.AUTONOMY_CHECKPOINT_PATH?.trim() || resolve(dirname(dbPath), "autonomy-checkpoint.json");
  let resumeHint: string | null = null;
  if (existsSync(checkpointPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(checkpointPath, "utf-8"));
      if (value && typeof value === "object") {
        const hint = value as Record<string, unknown>;
        if (hint.version === 2 && hint.goalFingerprint === fingerprint(persistedGoal)
          && hint.stateFingerprint === fingerprint(persistedState) && hint.requiresResume === true
          && typeof hint.nextAction === "string" && hint.nextAction.trim()) resumeHint = hint.nextAction;
      }
    } catch { /* A corrupt hint cannot override Compass state. */ }
  }

  // A pending approval remains gated. Only an independently authorized action may proceed.
  const mayResume = Boolean(resumeHint) && currentState.nextAction === resumeHint
    && currentState.status === "continue" && currentState.blockers.length === 0;
  if (resumeOnly && !mayResume) {
    const approvalPending = currentState.status === "approval_required";
    // Candidate discovery is informational; it never grants execution authority.
    const work = approvalPending
      ? await new CompassWorkStateStoreAdapter(activeCompass).get(goalWorkStateId(goal)) : null;
    const gated = work?.childWorkItems.filter(item => item.status === "BLOCKED") ?? [];
    const candidate = approvalPending ? selectIndependentWorkItem(
      work?.childWorkItems ?? [], gated.map(item => item.id),
      gated.flatMap(item => item.affectedScope),
    ) : null;
    // Preserve the pending gate. The scheduler may discover alternative work,
    // but cannot execute the gated action using this Goal's authority.
    const outcome = approvalPending ? "approval_pending_independent_work_required"
      : "resume_not_authorized_or_unavailable";
    process.stdout.write(`${JSON.stringify({
      status: outcome,
      dbPath,
      nextAction: approvalPending ? "Select an independently authorized work item" : null,
      approvalGatePreserved: approvalPending,
      independentCandidateId: candidate?.id ?? null,
    })}\n`);
    process.exitCode = 0;
  } else {
  const contextSource: ContextSource = {
    name: "compass-state",
    async collect() {
      if (heartbeatFailure) throw heartbeatFailure;
      const state = activeCompass.getState();
      const items = [];
      if (state.nextAction) items.push({ source: "state.next_action", summary: state.nextAction });
      else if (resumeHint) items.push({ source: "checkpoint.resume_hint", summary: resumeHint });
      items.push({ source: "state.status", summary: state.status ?? "unknown" });
      items.push({ source: "state.blockers", summary: JSON.stringify(state.blockers) });
      return items;
    },
  };

  let heartbeatFailure: Error | null = null;
  // The fenced dry-run path may only inspect state. Do not register code-building
  // capabilities until non-idempotent effects have a reconciliation contract.
  const fencedStorePath = process.env.AUTONOMY_FENCED_TASK_STORE_PATH?.trim();
  const registry = new CapabilityRegistry({ dryRun })
    .register(createContextInspectCapability());
  if (!sqliteFenced && !fencedStorePath) {
    registry.register(createCodeBuilderCapability(createRuntimeBuilderRouter()));
  }
  const verifier: Verifier = {
    async verify({ result }) {
      if (heartbeatFailure) throw heartbeatFailure;
      return { ok: result.ok, summary: result.ok ? "Capability execution verified" : result.summary, evidence: result.evidence };
    },
  };

  // Explicit opt-in only: the local durable store does not provide cross-node consensus.
  // Until a shared atomic Compass/fencing commit exists, guarded PASS writes fail closed.
  if (sqliteFenced && !dryRun) throw new Error("AUTONOMY_SQLITE_FENCE_EFFECT_RECONCILIATION_REQUIRED");
  if (sqliteFenced && fencedStorePath) throw new Error("AUTONOMY_FENCE_BACKENDS_CONFLICT");
  // A dry-run may inspect fencing state, but must never mutate the real Goal.
  // Keep the real execution path disabled until effect reconciliation is implemented.
  const sqliteLease = sqliteFenced ? activeCompass.executionLease() : null;
  // Recovery is inspection-only until effectful work has a reconciliation contract.
  // A pending external effect cannot be retried or treated as completed.
  // A requested external-effect recovery check must never be silently skipped
  // when the authoritative SQLite fencing backend is disabled.
  if (recoveryActionId && !sqliteLease) {
    throw new Error("AUTONOMY_RECOVERY_REQUIRES_SQLITE_FENCE");
  }
  if (sqliteLease && recoveryActionId) {
    const decision = sourceRecoveryDecision ?? sqliteLease.recoveryDecision(goalWorkStateId(goal), recoveryActionId);
    if (decision !== "READY_FOR_FIRST_EXECUTION") {
      process.stdout.write(`${JSON.stringify({ status: decision, actionId: recoveryActionId, executable: false })}\\n`);
      throw new Error(`AUTONOMY_RECOVERY_EFFECT_NOT_EXECUTABLE: ${decision}`);
    }
  }
  const sqliteClaim = sqliteLease?.claim(goalWorkStateId(goal), `${hostname()}:${runId}`, 60_000);
  const assertSqliteAuthority = sqliteLease && sqliteClaim
    ? () => sqliteLease.assertCurrent(sqliteClaim) : undefined;
  let writeAuthority: (() => Promise<void>) | undefined;
  if (fencedStorePath && !dryRun) {
    // A pre-write claim check is not atomic with Compass or work-state writes.
    // Do not execute capabilities that could cause effects before the final
    // write-back is rejected. Keep the experimental path read-only for now.
    throw new Error("AUTONOMY_FENCED_ATOMIC_COMMIT_REQUIRED: cannot execute with separate durable and Compass stores");
  }
  if (fencedStorePath) {
    const durable = new DurableTaskRuntime(dryRun ? new MemoryDurableTaskStore() : new JsonFileDurableTaskStore(resolve(fencedStorePath)));
    const taskId = goalWorkStateId(goal);
    await durable.enqueue({ id: taskId, idempotencyKey: taskId, type: "autonomy-goal-execution", migrationClass: "RESTARTABLE" });
    await durable.reclaimExpiredLeases();
    const claim = await durable.leaseClaim(taskId, `${hostname()}:${runId}`);
    writeAuthority = durableClaimWriteAuthority(durable, claim);
  }

  const loop = createWorkStateIntegratedGoalLoop({
    goal,
    planner: new RuntimeDevelopmentPlanner(new BaselinePlanner()),
    contextSources: [contextSource],
    executor: registry,
    verifier,
    stateStore: new CompassStateStoreAdapter(activeCompass, writeAuthority, assertSqliteAuthority),
    workStateStore: new CompassWorkStateStoreAdapter(activeCompass, Boolean(fencedStorePath || sqliteFenced), assertSqliteAuthority),
  });

  // The SQLite-fenced path remains dry-run only until external effects are reconciled.
  // Keep the claim alive while a bounded loop runs, then release it on exit.
  const heartbeat = sqliteLease && sqliteClaim
    ? setInterval(() => {
        if (heartbeatFailure) return;
        try { sqliteLease.renew(sqliteClaim, 60_000); }
        catch (error) { heartbeatFailure = error instanceof Error ? error : new Error(String(error)); }
      }, 20_000)
    : null;
  let report: Awaited<ReturnType<typeof runBoundedGoalLoop>>;
  try {
    report = await runBoundedGoalLoop(loop, goal, { maxCycles });
    if (heartbeatFailure) throw heartbeatFailure;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (sqliteLease && sqliteClaim && !heartbeatFailure) {
      try { sqliteLease.release(sqliteClaim); }
      catch { /* An expired or transferred claim must not be released by the old owner. */ }
    }
  }
  // Preserve a bounded, non-secret checkpoint for the next scheduler invocation.
  // Compass remains the authoritative durable Goal and work-state store.
  if (!dryRun) {
    const state = activeCompass.getState();
    const checkpoint = {
      version: 2,
      goalFingerprint: fingerprint(activeCompass.getGoal()),
      stateFingerprint: fingerprint(state),
      observedAt: new Date().toISOString(),
      status: state.status ?? "unknown",
      nextAction: state.nextAction ?? null,
      requiresResume: Boolean(state.nextAction?.trim()) && state.status === "continue" && state.blockers.length === 0,
    };
    mkdirSync(dirname(checkpointPath), { recursive: true });
    const temporaryPath = `${checkpointPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    renameSync(temporaryPath, checkpointPath);
  }
  process.stdout.write(`${JSON.stringify({ dryRun, dbPath, report }, null, 2)}\n`);
  }
} finally {
  try {
    compass?.close();
  } finally {
    releaseOwnedLock();
  }
}
