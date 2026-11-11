import type { DevelopmentResourceWait } from "./development-resource-wait.ts";
export type WorkRunPhase="QUEUED"|"PLANNING"|"RUNNING"|"VERIFYING"|"RECOVERING"|"HUMAN_GATE"|"BLOCKED"|"COMPLETED"|"FAILED";
export interface WorkRunState{resourceWait?:DevelopmentResourceWait;continuationWait?:GoalContinuationWait;runId:string;goalId:string;phase:WorkRunPhase;currentWork:string|null;completedJobs:number;totalJobs:number|null;recoveryCount:number;blockers:string[];nextAction:string|null;evidenceRefs:string[];createdAt:string;updatedAt:string;}
export interface WorkRunStore{getByGoal(goalId:string):Promise<WorkRunState|null>;put(state:WorkRunState):Promise<void>;}
export function createQueuedWorkRun(goalId:string,now=new Date().toISOString()):WorkRunState{return{runId:`run-${goalId}`,goalId,phase:"QUEUED",currentWork:null,completedJobs:0,totalJobs:null,recoveryCount:0,blockers:[],nextAction:"Plan Goal",evidenceRefs:[],createdAt:now,updatedAt:now};}
export function workRunProgress(state:WorkRunState):{determinate:boolean;value:number|null}{if(state.blockers.some(b=>b.startsWith("spec_sync_")))return{determinate:false,value:null};if(state.phase==="COMPLETED")return{determinate:true,value:1};if(!state.totalJobs||state.totalJobs<1)return{determinate:false,value:null};return{determinate:true,value:Math.max(0,Math.min(1,state.completedJobs/state.totalJobs))};}

/**
 * A bounded process chunk is not a Goal failure. This is a distinct checkpoint
 * from capacity pressure, retry exhaustion or an owner Human Gate.
 */
export interface GoalContinuationWait { retryAt:string; slices:number }
export const GOAL_CONTINUATION_DELAY_MS=5_000;
export const MAX_GOAL_CONTINUATION_SLICES=20;

export function assertGoalContinuation(value:GoalContinuationWait):void{
 if(!value||typeof value.retryAt!=="string"||!Number.isFinite(Date.parse(value.retryAt))
   ||!Number.isInteger(value.slices)||value.slices<1||value.slices>MAX_GOAL_CONTINUATION_SLICES) {
   throw Error("invalid goal continuation checkpoint");
 }
}

/** Returns null at the finite ceiling; the caller must mark a real stop. */
export function nextGoalContinuation(previous:GoalContinuationWait|undefined,now:Date):GoalContinuationWait|null{
 if(previous)assertGoalContinuation(previous);
 if(!Number.isFinite(now.getTime()))throw Error("invalid goal continuation clock");
 if(previous?.slices===MAX_GOAL_CONTINUATION_SLICES)return null;
 return{retryAt:new Date(now.getTime()+GOAL_CONTINUATION_DELAY_MS).toISOString(),slices:(previous?.slices??0)+1};
}

/** One authoritative mapping used by WorkRun writeback. */
export function goalExecutionPhase(reason:string|undefined):WorkRunPhase{
 if(reason==="goal_complete")return "COMPLETED";
 if(reason==="human_gate")return "HUMAN_GATE";
 if(reason==="publication_wait"||reason==="resource_wait"||
   reason==="verification_wait"||reason==="goal_continuation_budget_exhausted")return "RUNNING";
 return "BLOCKED";
}
