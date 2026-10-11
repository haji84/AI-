import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";
import { assessAutonomyLock } from "../src/orchestrator/autonomy-lock-assessment.ts";
import { CompassStore } from "../src/compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { RuntimeDevelopmentPlanner } from "../src/orchestrator/runtime-development-planner.ts";
import { createCodeBuilderCapability, createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
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

// Atomic exclusive lock. A crash leaves the lock in place until reconciled.
const lockPath = dbPath + ".autonomy-lock";
const lockOwnerPath = resolve(lockPath, "owner.json");
mkdirSync(dirname(lockPath), { recursive: true });
try {
  mkdirSync(lockPath);

} catch (error) {
  const assessment = assessAutonomyLock(lockPath);
  throw new Error(`autonomy already locked (${assessment}); reconcile previous run before retry`, { cause: error });
}
try {
  writeFileSync(lockOwnerPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname() }) + "\n", { flag: "wx", mode: 0o600 });
} catch (error) {
  rmSync(lockPath, { recursive: true, force: true });
  throw error;
}
let compass: CompassStore | null = null;
try {
  compass = new CompassStore(dbPath);
  const activeCompass = compass;
  const goalRecord = activeCompass.getGoal();
  if (!goalRecord) throw new Error("Compass goal is not set");
  const goal = compassGoalToLoopGoal(goalRecord);
  const checkpointPath: string = process.env.AUTONOMY_CHECKPOINT_PATH?.trim() || resolve(dirname(dbPath), "autonomy-checkpoint.json");
  let resumeHint: string | null = null;
  if (existsSync(checkpointPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(checkpointPath, "utf-8"));
      if (value && typeof value === "object") {
        const hint = value as Record<string, unknown>;
        if (hint.version === 1 && hint.goalTitle === goal.title && hint.requiresResume === true
          && typeof hint.nextAction === "string") resumeHint = hint.nextAction;
      }
    } catch { /* A corrupt hint cannot override Compass state. */ }
  }

  const currentState = activeCompass.getState();
  // A pending approval remains gated. Only an independently authorized action may proceed.
  const mayResume = Boolean(resumeHint) && currentState.nextAction === resumeHint && currentState.status !== "ACHIEVED"
    && currentState.status !== "PAUSED"
    && currentState.status !== "BLOCKED" && currentState.status !== "approval_required";
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
      const state = activeCompass.getState();
      const items = [];
      if (state.nextAction) items.push({ source: "state.next_action", summary: state.nextAction });
      else if (resumeHint) items.push({ source: "checkpoint.resume_hint", summary: resumeHint });
      items.push({ source: "state.status", summary: state.status ?? "unknown" });
      items.push({ source: "state.blockers", summary: JSON.stringify(state.blockers) });
      return items;
    },
  };

  const registry = new CapabilityRegistry({ dryRun })
    .register(createContextInspectCapability())
    .register(createCodeBuilderCapability(createRuntimeBuilderRouter()));
  const verifier: Verifier = {
    async verify({ result }) {
      return { ok: result.ok, summary: result.ok ? "Capability execution verified" : result.summary, evidence: result.evidence };
    },
  };

  const loop = createWorkStateIntegratedGoalLoop({
    goal,
    planner: new RuntimeDevelopmentPlanner(new BaselinePlanner()),
    contextSources: [contextSource],
    executor: registry,
    verifier,
    stateStore: new CompassStateStoreAdapter(activeCompass),
    workStateStore: new CompassWorkStateStoreAdapter(activeCompass),
  });

  const report = await runBoundedGoalLoop(loop, goal, { maxCycles });
  // Preserve a bounded, non-secret checkpoint for the next scheduler invocation.
  // Compass remains the authoritative durable Goal and work-state store.
  if (!dryRun) {
    const state = activeCompass.getState();
    const checkpoint = {
      version: 1,
      goalTitle: goal.title,
      observedAt: new Date().toISOString(),
      status: state.status ?? "unknown",
      nextAction: state.nextAction ?? null,
      requiresResume: Boolean(state.nextAction) && state.status !== "ACHIEVED" && state.status !== "PAUSED" && state.status !== "BLOCKED" && state.status !== "approval_required",
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
    rmSync(lockPath, { recursive: true, force: true });
  }
}
