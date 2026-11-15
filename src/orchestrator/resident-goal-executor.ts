import { CompassGoalExecutionAdapter, type DevelopmentGoalRuntime } from "./compass-goal-execution-adapter.ts";
import { GoalControllerExecutionBridge, type GoalExecutionResult } from "./goal-controller-execution-bridge.ts";
import type { GoalControllerDecision } from "./goal-controller-runtime.ts";
import { createGoalBridgeEvent, type GoalBridgeEventType } from "./goal-bridge-events.ts";
import { assertGoalContinuation, goalExecutionPhase, nextGoalContinuation, type WorkRunState } from "./work-run-state.ts";
import { nextResourceWait, resourceWaitExhausted } from "./development-resource-wait.ts";
import { ResourceWaitError } from "../gai/development-resource-admission.ts";
import { acquireResidentExecutionWriter, isResidentExecutionWriter, type ResidentExecutionWriter } from "./resident-development-admission.ts";
import { residentRunnablePhases, type ResidentExecutionAuthority } from "./resident-execution-authority.ts";
import { evaluateGoalFromWorkState } from "./goal-evaluator.ts";
import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";

export function residentExecutorDecision(goalId: string): GoalControllerDecision {
  const key = `executor-${goalId}`;
  return { resolution: { kind:"EXISTING_GOAL",intent:"COMMAND",intake:{id:key,source:"event",text:"Continue persisted autonomous Goal execution",
    sourceContext:{},idempotencyKey:key,goalHint:goalId},reason:"broker_scheduled_goal_execution" },
    action:"CONTINUE_GOAL",goalId,nextAction:null,remainingCriteria:[] };
}

/** The existing executor's bounded Resident path. Host composition supplies
 * existing stores/capabilities; this runner never bootstraps or selects a model. */
export async function executeGoal(input: {
  goalId: string; context: unknown[]; authority: ResidentExecutionAuthority;
  runtime: DevelopmentGoalRuntime; writer?: ResidentExecutionWriter; maxRuns?: number;
}): Promise<GoalExecutionResult> {
  const {goalId,authority}=input,decision=residentExecutorDecision(goalId);
  const idle=(reason:string):GoalExecutionResult=>({decision,executed:false,reason});
  let writer=input.writer,owned=false;
  const writeRun=async(patch:Partial<WorkRunState>,type?:GoalBridgeEventType,summary?:string):Promise<boolean>=>{
    writer!.assertHeld();await authority.assertFence();
    const current=await authority.read(goalId);
    if(current.control.status==="PAUSED"||!residentRunnablePhases.includes(current.run.phase)||
      current.run.blockers.length||current.control.blockers.length||canonicalRequirementBlockers(current.control.active,goalId).length)return false;
    if(authority.kind==="shared"&&patch.phase==="COMPLETED"&&(!current.work||!evaluateGoalFromWorkState(current.work).achieved))throw Error("RESIDENT_GOAL_PROGRESS_UNVERIFIED");
    const run={...current.run,...patch,updatedAt:new Date(Math.max(Date.now(),Date.parse(current.run.updatedAt))).toISOString()};
    const events=type?[...current.events,createGoalBridgeEvent({goalId,type,summary:summary??"goal_execution_updated",evidenceRefs:[]})]:current.events;
    await authority.commit(current,{...current,run,events});return true;
  };
  try {
    const leasePath=`${authority.authorityPath}.cognitive-run.lock`;
    if(!writer){writer=await acquireResidentExecutionWriter(leasePath,goalId);owned=true;}
    if(!isResidentExecutionWriter(writer,goalId,leasePath))throw Error("RESIDENT_EXECUTION_WRITER_BINDING_INVALID");
    writer.assertHeld();await authority.assertFence();
    const initial=await authority.read(goalId),current=initial.run;
    if(initial.control.status==="PAUSED")return idle("paused");
    if(!residentRunnablePhases.includes(current.phase))return idle("canonical_run_stopped");
    if(current.blockers.length||initial.control.blockers.length||canonicalRequirementBlockers(initial.control.active,goalId).length)return idle("canonical_authority_blocked");
    if(current.continuationWait){
      assertGoalContinuation(current.continuationWait);
      if(current.resourceWait)throw Error("GOAL_CONTINUATION_CONFLICTS_WITH_RESOURCE_WAIT");
      if(Date.now()<Date.parse(current.continuationWait.retryAt))return idle("continuation_not_due");
    }
    if(current.resourceWait){
      if(resourceWaitExhausted(current.resourceWait,new Date())){
        await writeRun({phase:"BLOCKED",resourceWait:undefined,blockers:["resource_wait_budget_exhausted"],nextAction:"resource_wait_budget_exhausted"},"GOAL_BLOCKED","resource_wait_budget_exhausted");
        return idle("resource_wait_budget_exhausted");
      }
      if(Date.now()<Date.parse(current.resourceWait.retryAt))return idle("resource_retry_not_due");
    }
    if(!await writeRun({phase:"RUNNING",nextAction:"Execute accepted Goal",blockers:[]}))return idle("canonical_authority_stopped");
    const adapter=new CompassGoalExecutionAdapter(authority.authorityPath,{}, {},{runtime:input.runtime,writer,authority});
    const result=await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(decision,{maxRuns:input.maxRuns??12,context:input.context});
    if(result.reason==="paused")return result;
    if(result.reason==="goal_continuation_budget_exhausted"){
      const latest=await authority.read(goalId);
      if(latest.control.status==="PAUSED")return {...result,reason:"paused"};
      if(latest.run.phase!=="RUNNING"||latest.run.resourceWait)throw Error("GOAL_CONTINUATION_NOT_RUNNING");
      const continuation=nextGoalContinuation(latest.run.continuationWait,new Date()),reason=continuation?"goal_continuation_checkpointed":"goal_continuation_slice_limit";
      await writeRun({phase:continuation?"RUNNING":"BLOCKED",continuationWait:continuation??undefined,
        blockers:continuation?[]:[reason],nextAction:continuation?"resume_bounded_goal_chunk":reason},continuation?"IMPORTANT_UPDATE":"GOAL_BLOCKED",reason);
      return result;
    }
    const phase=goalExecutionPhase(result.reason),reason=result.reason??result.report?.stopReason??"goal_execution_incomplete";
    const type:GoalBridgeEventType=phase==="COMPLETED"?"GOAL_COMPLETED":phase==="HUMAN_GATE"?"HUMAN_REQUIRED":phase==="BLOCKED"?"GOAL_BLOCKED":"IMPORTANT_UPDATE";
    const saved=await writeRun({phase,resourceWait:result.report?.resourceWait??undefined,continuationWait:undefined,
      blockers:phase==="BLOCKED"?[reason]:[],nextAction:phase==="COMPLETED"?null:reason},type,reason);
    if(!saved){
      const stopped=await authority.read(goalId),reason=stopped.control.status==="PAUSED"?"paused":stopped.run.phase==="HUMAN_GATE"?"human_gate":"blocked";
      return {...result,reason,report:result.report?{...result.report,stopReason:reason==="human_gate"?"approval_required":reason,
        ...(result.report.goalEvaluation?{goalEvaluation:{...result.report.goalEvaluation,achieved:false,blockers:[reason],remainingGaps:[reason]}}:{})}:undefined};
    }
    return result;
  } catch(error) {
    // Shared exceptions may follow a rejected or already committed CAS with a
    // lost receipt. Never acquire a fresh observation here to write a status.
    // Definitive Resident outcomes use the normal durable report path above.
    if(authority.kind==="shared")throw error;
    if(error instanceof ResourceWaitError && writer){
      const current=await authority.read(goalId),exhausted=current.run.resourceWait&&resourceWaitExhausted(current.run.resourceWait,new Date());
      const reason=exhausted?"resource_wait_budget_exhausted":"resource_wait:"+error.outcome.reason;
      await writeRun({phase:exhausted?"BLOCKED":"RUNNING",resourceWait:exhausted?undefined:nextResourceWait(current.run.resourceWait,error.outcome,new Date()),
        continuationWait:undefined,blockers:exhausted?[reason]:[],nextAction:reason},exhausted?"GOAL_BLOCKED":"IMPORTANT_UPDATE",reason);
      return idle(exhausted?"resource_wait_budget_exhausted":"resource_wait");
    }
    // The default CLI retains its existing Compass error/exit handling.
    throw error;
  } finally {if(owned)await writer?.release();}
}
