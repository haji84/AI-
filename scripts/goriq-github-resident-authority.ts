import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { StateRecord } from "../src/compass/store.ts";
import type { WorkRunState } from "../src/orchestrator/work-run-state.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { assertResidentAuthority, assertResidentMutation, residentControl, type ResidentAuthoritySnapshot, type ResidentExecutionAuthority } from "../src/orchestrator/resident-execution-authority.ts";
import { canonicalRequirementBlockers } from "../src/orchestrator/owner-requirement-canonical.ts";
import { ResidentExecutionStop } from "../src/orchestrator/resident-development-admission.ts";
import { createGitHubResidentPersistence } from "./goriq-github-change-set-journal.ts";
import type { GitHubFencedCheckpointStores } from "./goriq-github-checkpoint-stores.ts";
import type { GitHubGoalCheckpoint } from "./goriq-github-coordinator-store.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function fail(code: string): never { throw Error("RESIDENT_AUTHORITY_" + code); }
const nonempty=(v:unknown):v is string=>typeof v==="string"&&Boolean(v.trim());
const textOrNull=(v:unknown)=>v===null||typeof v==="string";
const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(nonempty);
const statuses=["NOT_STARTED","IN_PROGRESS","BLOCKED","VERIFYING","COMPLETED","FAILED"];
function unique(items:unknown[],field:string):boolean{return items.every(object)&&new Set(items.map(item=>(item as Record<string,unknown>)[field])).size===items.length;}
function criteria(v:unknown):boolean{return Array.isArray(v)&&unique(v,"id")&&v.every(item=>object(item)&&nonempty(item.id)&&nonempty(item.description)&&(item.required===undefined||typeof item.required==="boolean"));}
function validRun(v:unknown):boolean {
  if(!object(v))return false;
  return nonempty(v.goalId)&&nonempty(v.runId)&&typeof v.phase==="string"&&["QUEUED","PLANNING","RUNNING","VERIFYING","RECOVERING","HUMAN_GATE","BLOCKED","COMPLETED","FAILED"].includes(v.phase)&&
    textOrNull(v.currentWork)&&textOrNull(v.nextAction)&&strings(v.blockers)&&strings(v.evidenceRefs)&&date(v.createdAt)&&date(v.updatedAt)&&
    [v.completedJobs,v.recoveryCount].every(value=>Number.isSafeInteger(value)&&(value as number)>=0)&&
    (v.totalJobs===null||Number.isSafeInteger(v.totalJobs)&&(v.totalJobs as number)>=0);
}
function validWork(v:unknown):boolean {
  if(!object(v)||!nonempty(v.goalId)||!nonempty(v.objective)||typeof v.currentState!=="string"||typeof v.status!=="string"||!statuses.includes(v.status)||
     typeof v.riskClass!=="string"||!["R0","R1","R2","R3","R4"].includes(v.riskClass)||!date(v.updatedAt)||!criteria(v.definitionOfDone)||
     !strings(v.constraints)||!strings(v.blockers)||(v.nextAction!==undefined&&!textOrNull(v.nextAction)))return false;
  if(!Array.isArray(v.decisions)||!unique(v.decisions,"id")||!v.decisions.every(item=>object(item)&&nonempty(item.id)&&nonempty(item.summary)&&date(item.at)&&(item.rationale===undefined||typeof item.rationale==="string")))return false;
  if(!Array.isArray(v.artifacts)||!unique(v.artifacts,"id")||!v.artifacts.every(item=>object(item)&&nonempty(item.id)&&nonempty(item.uri)&&(item.kind===undefined||typeof item.kind==="string")&&(item.summary===undefined||typeof item.summary==="string")))return false;
  if(!Array.isArray(v.verificationResults)||!unique(v.verificationResults,"itemId")||!v.verificationResults.every(item=>object(item)&&nonempty(item.itemId)&&
     (v.definitionOfDone as Array<{id:string}>).some(c=>c.id===item.itemId)&&typeof item.passed==="boolean"&&(item.waived===undefined||typeof item.waived==="boolean")&&(item.note===undefined||typeof item.note==="string")))return false;
  return Array.isArray(v.childWorkItems)&&unique(v.childWorkItems,"id")&&v.childWorkItems.every(item=>object(item)&&nonempty(item.id)&&nonempty(item.objective)&&
    criteria(item.definitionOfDone)&&strings(item.affectedScope)&&nonempty(item.executionApproach)&&nonempty(item.verificationMethod)&&typeof item.status==="string"&&statuses.includes(item.status));
}
function validEvents(v:unknown,goalId:string):boolean {
  return Array.isArray(v)&&unique(v,"id")&&v.every(event=>object(event)&&nonempty(event.id)&&event.goalId===goalId&&
    typeof event.type==="string"&&["GOAL_COMPLETED","GOAL_BLOCKED","HUMAN_REQUIRED","IMPORTANT_UPDATE"].includes(event.type)&&typeof event.summary==="string"&&
    strings(event.evidenceRefs)&&date(event.createdAt)&&(event.deliveredAt===undefined||date(event.deliveredAt)));
}
function validSourceState(state:Record<string,unknown>):boolean {
  return Object.keys(state).sort().join(",")==="active,blockers,completed,decisions,deliverables,nextAction,phase,projectId,status,updatedAt,verificationSummary"&&
    nonempty(state.projectId)&&textOrNull(state.phase)&&textOrNull(state.status)&&textOrNull(state.nextAction)&&textOrNull(state.verificationSummary)&&
    date(state.updatedAt)&&[state.active,state.blockers,state.completed,state.decisions,state.deliverables].every(Array.isArray);
}
function validate(snapshot: ResidentAuthoritySnapshot, checkpoint: GitHubGoalCheckpoint): void {
  const goal = compassGoalToLoopGoal({ ...checkpoint.goal, id: 1 });
  if (!snapshot || snapshot.goalId !== checkpoint.goalId || goalWorkStateId(goal) !== checkpoint.goalId || !isDeepStrictEqual(snapshot.goal, goal) ||
      !object(snapshot.control)||Object.keys(snapshot.control).sort().join(",")!=="active,blockers,nextAction,status"||!textOrNull(snapshot.control.status)||!textOrNull(snapshot.control.nextAction)||
      !Array.isArray(snapshot.control.active)||!Array.isArray(snapshot.control.blockers)||!isDeepStrictEqual(residentControl(snapshot.control),snapshot.control)||
      !validRun(snapshot.run)||snapshot.run.goalId!==checkpoint.goalId||snapshot.run.runId!==checkpoint.workRun.runId||
      !validWork(snapshot.work)||snapshot.work!.goalId!==checkpoint.goalId||snapshot.work!.objective!==(goal.description?.trim()||goal.title)||!isDeepStrictEqual(snapshot.work!.constraints,goal.constraints)||
      !isDeepStrictEqual(snapshot.work!.definitionOfDone,goal.successCriteria.map((description,index)=>({id:`criterion-${index+1}`,description,required:true})))||
      !validEvents(snapshot.events,checkpoint.goalId)) fail("JOURNAL_INVALID");
}

/** Projection only. A complete externally authenticated original import is
 * mandatory; this module contains no import/bootstrap or owner-control writer. */
function project(checkpoint: GitHubGoalCheckpoint): { snapshot: ResidentAuthoritySnapshot; head: string } {
  let snapshot: ResidentAuthoritySnapshot | undefined, head = "";
  for (const event of checkpoint.events) {
    if (!object(event.record) || typeof event.record.kind !== "string" || !event.record.kind.startsWith("goriq-resident-authority-")) continue;
    const record = event.record;
    if (event.recordSha256 !== hash(record) || record.goalId !== checkpoint.goalId || record.goalContractDigest !== checkpoint.goalContractDigest) fail("JOURNAL_INVALID");
    if (record.kind === "goriq-resident-authority-import-v1") {
      if (snapshot || !object(record.sourceState) || !validSourceState(record.sourceState)) fail("JOURNAL_INVALID");
      const state = record.sourceState as unknown as StateRecord;
      const envelopes=state.active.filter(object);
      const runEnvelopes=envelopes.filter(value=>value.kind==="jarvis-work-runs"),workEnvelopes=envelopes.filter(value=>value.kind==="gai-work-state"&&value.goalId===checkpoint.goalId),eventEnvelopes=envelopes.filter(value=>value.kind==="goriq-goal-bridge-events");
      if(runEnvelopes.length!==1||workEnvelopes.length!==1||eventEnvelopes.length>1||
        [...runEnvelopes,...workEnvelopes,...eventEnvelopes].some(value=>value.version!==1)||
        !Array.isArray(runEnvelopes[0].runs)||!unique(runEnvelopes[0].runs,"goalId")||!runEnvelopes[0].runs.every(validRun)||
        !Array.isArray(workEnvelopes[0].events)||!workEnvelopes[0].events.every(value=>object(value)&&nonempty(value.id)&&date(value.at)&&nonempty(value.type)&&typeof value.summary==="string"))fail("IMPORT_INCOMPLETE");
      const runs = runEnvelopes[0] as { runs?: WorkRunState[] };
      const work = state.active.find(value => object(value) && value.kind === "gai-work-state" && value.goalId === checkpoint.goalId) as { state?: unknown } | undefined;
      const events = state.active.find(value => object(value) && value.kind === "goriq-goal-bridge-events") as { events?: unknown[] } | undefined;
      const run = runs?.runs?.find(value => value.goalId === checkpoint.goalId);
      if (!run || !work || !isDeepStrictEqual(record.workState, work.state) || !isDeepStrictEqual(record.bridgeEvents, events?.events ?? [])) fail("IMPORT_INCOMPLETE");
      snapshot = { goalId: checkpoint.goalId, goal: compassGoalToLoopGoal({ ...checkpoint.goal, id: 1 }), control: residentControl(state),
        run, work: record.workState, events: record.bridgeEvents } as ResidentAuthoritySnapshot;
    } else if (record.kind === "goriq-resident-authority-update-v1") {
      if (!snapshot || record.previousRecordSha256 !== head) fail("JOURNAL_INVALID");
      const next = record.snapshot as ResidentAuthoritySnapshot;
      validate(next, checkpoint);
      // Owner-control changes may arrive through the already authenticated
      // canonical controller. Runtime commit below cannot issue those changes.
      assertResidentMutation({ ...snapshot, control: next.control }, next);
      snapshot = next;
    } else fail("JOURNAL_INVALID");
    validate(snapshot, checkpoint); head = event.recordSha256;
  }
  if (!snapshot) fail("IMPORT_REQUIRED");
  if (!isDeepStrictEqual(snapshot.run, checkpoint.workRun)) fail("RUN_PROJECTION_MISMATCH");
  return { snapshot: structuredClone(snapshot), head };
}

export async function createGitHubResidentExecutionAuthority(input: {
  stores: GitHubFencedCheckpointStores; authorityPath: string;
}): Promise<ResidentExecutionAuthority> {
  const { stores } = input;
  await stores.assertAuthoritative();
  project(await stores.load());
  const assertCanonicalControl=(checkpoint:GitHubGoalCheckpoint)=>{
    const current=project(checkpoint).snapshot;
    // Derived WorkState blockers may be the outcome being finalized. Owner
    // controls, requirements, terminal stops and run blockers remain mandatory.
    assertResidentAuthority({...current,work:null});
    if(current.run.blockers.length||canonicalRequirementBlockers(current.control.active,current.goalId).length)throw new ResidentExecutionStop("blocked","resident_authority_blocked");
  };
  const commitStores=stores.withMutationGuard(assertCanonicalControl);
  const persistence = await createGitHubResidentPersistence(stores.withMutationGuard(checkpoint=>{
    assertCanonicalControl(checkpoint);assertResidentAuthority(project(checkpoint).snapshot);
  }));
  const observed = new WeakMap<ResidentAuthoritySnapshot, { checkpoint: GitHubGoalCheckpoint; snapshot: ResidentAuthoritySnapshot; head: string }>();
  return { kind: "shared", authorityPath: resolve(input.authorityPath), persistence,
    assertFence: () => stores.assertAuthoritative(),
    async read(goalId) {
      await stores.assertAuthoritative();
      const checkpoint = await stores.load(), current = project(checkpoint);
      if (goalId !== checkpoint.goalId) fail("GOAL_MISMATCH");
      observed.set(current.snapshot, { checkpoint, snapshot: structuredClone(current.snapshot), head: current.head });
      return current.snapshot;
    }, async commit(expected, next) {
      // Capture once before any await: callers cannot mutate validated state while the fence is read.
      next = structuredClone(next);
      const prior = observed.get(expected); observed.delete(expected);
      if (!prior || !isDeepStrictEqual(prior.snapshot, expected)) fail("READ_REQUIRED");
      validate(next, prior.checkpoint); assertResidentMutation(prior.snapshot, next);
      await stores.assertAuthoritative();
      const current = await stores.load();
      if (!isDeepStrictEqual(current, prior.checkpoint)) fail("STALE");
      const record = {kind:"goriq-resident-authority-update-v1",goalId:current.goalId,goalContractDigest:current.goalContractDigest,
        previousRecordSha256:prior.head,snapshot:structuredClone(next)};
      const digest=hash(record),proposed=structuredClone(current);
      proposed.workRun=structuredClone(next.run);
      proposed.events.push({eventId:"resident-authority:"+digest,record,recordSha256:digest});
      if (!await commitStores.commitTogether(current,proposed)) fail("CONFLICT");
    },
  };
}
