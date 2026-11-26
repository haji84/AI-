import type { GoalControllerDecision } from "./goal-controller-runtime.ts";
import type { ResidentExecutionAuthority, ResidentAuthoritySnapshot } from "./resident-execution-authority.ts";
import { assertResidentAuthority } from "./resident-execution-authority.ts";
import type { DevelopmentGoalRuntime } from "./compass-goal-execution-adapter.ts";
import { executeGoal } from "./resident-goal-executor.ts";
import { assertGoalContinuation } from "./work-run-state.ts";
import { resourceWaitExhausted } from "./development-resource-wait.ts";
import { ResidentExecutionStop } from "./resident-development-admission.ts";

export interface SharedResidentGoalBinding {
  authority: ResidentExecutionAuthority;
  runtimeFor(snapshot: ResidentAuthoritySnapshot): Promise<DevelopmentGoalRuntime>;
  maxRuns?: number;
}

/** Scheduling for accepted decisions in the existing Broker. This creates no
 * Goal/intake, trigger, election or recurring task. The default callback keeps
 * the existing child process isolation; an explicit shared binding never calls it. */
export function createBrokerResidentGoalScheduling(input: {
  authority: ResidentExecutionAuthority;
  dispatchLocal(decision: GoalControllerDecision, context: unknown[]): Promise<void>;
}) {
  let binding: SharedResidentGoalBinding | undefined;
  const pending = new Set<string>();
  const schedule = (decision: GoalControllerDecision, context: unknown[] = []): Promise<boolean> => {
    const selected=binding,authority=selected?.authority??input.authority;
    if(authority.kind==="shared"&&!selected)throw Error("SHARED_BINDING_REQUIRED");
    if(decision.action!=="CONTINUE_GOAL"||!decision.goalId||pending.has(decision.goalId))return Promise.resolve(false);
    const goalId=decision.goalId;pending.add(goalId);
    return (async()=>{
      try{
        await authority.assertFence();const current=await authority.read(goalId);
        try{assertResidentAuthority(current);}catch(error){if(error instanceof ResidentExecutionStop)return false;throw error;}
        if(current.run.continuationWait){assertGoalContinuation(current.run.continuationWait);
          if(current.run.resourceWait)throw Error("GOAL_CONTINUATION_CONFLICTS_WITH_RESOURCE_WAIT");
          if(Date.now()<Date.parse(current.run.continuationWait.retryAt))return false;}
        if(current.run.resourceWait&&!resourceWaitExhausted(current.run.resourceWait,new Date())&&Date.now()<Date.parse(current.run.resourceWait.retryAt))return false;
        if(selected){
          const runtime=await selected.runtimeFor(current);
          // Runtime selection awaited host code; the runner independently rereads
          // canonical control/budget/fence before any work or result mutation.
          await executeGoal({goalId,context,authority,runtime,maxRuns:selected.maxRuns});
        }else await input.dispatchLocal(decision,context);
        return true;
      }finally{pending.delete(goalId);}
    })();
  };
  return {schedule,isPending:(goalId:string)=>pending.has(goalId),get kind(){return binding?.authority.kind??input.authority.kind;},
    bindShared(next:SharedResidentGoalBinding){
      if(binding||pending.size)throw Error("RESIDENT_BINDING_ALREADY_ACTIVE");
      if(next.authority.kind!=="shared")throw Error("SHARED_AUTHORITY_REQUIRED");
      binding=Object.freeze({...next});
    },
  };
}
