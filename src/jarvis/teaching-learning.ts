import { createHash } from 'node:crypto';
import { DemonstrationLearningEngine, type DemoEvent } from './demonstration-learning.ts';
import { profileKey, type TeachingStore, type TeachingVariant, type TeachingRun } from './teaching.ts';

export type TeachingLearningCandidate = {
  variantId: string;
  sourceDigest: string;
  state: 'OBSERVED' | 'NEEDS_VALIDATION' | 'VALIDATED';
  correctionState: 'UNKNOWN';
  executable: false;
  verifiedRunIds: string[];
  workflow: ReturnType<DemonstrationLearningEngine['inferWorkflow']>;
};

/** Read-only projection of durable observations, never a replay or permission grant.
 * The legacy recording format has no explicit correction relation. Do not invent
 * mistakes or silently delete actions based on similar screens/targets. */
export function teachingLearningCandidate(variant: TeachingVariant, runs: TeachingRun[]): TeachingLearningCandidate {
  const digest = createHash('sha256').update(JSON.stringify([variant.id,variant.profile,variant.scope,variant.goal,variant.completion,variant.steps,variant.finalScreen])).digest('hex');
  const events: DemoEvent[] = [];
  let incomplete = variant.status === 'RECORDING' || !variant.completion || !variant.finalScreen || !variant.steps.length;
  for (const [index, step] of variant.steps.entries()) {
    if (step.gate || step.action.kind === 'manual' || !step.before || !step.after || (index > 0 && variant.steps[index - 1].after !== step.before)) {
      incomplete = true;
      continue;
    }
    // No raw manual notes, URL, screen text or selector in generated rules.
    const target = createHash('sha256').update(JSON.stringify(step.action)).digest('hex');
    events.push({at:variant.createdAt,kind:step.action.kind === 'tap' ? 'tap' : 'click',target,before:step.before,after:step.after});
  }
  if (variant.steps.at(-1)?.after !== variant.finalScreen) incomplete = true;
  const relevant = runs.filter(run => run.variantId === variant.id && run.deviceId === variant.profile.deviceId && run.profileKey === profileKey(variant.profile));
  const failed = relevant.some(run => run.status !== 'PASSED');
  const verifiedRunIds = [...new Set(relevant.filter(run => run.mode === 'verify' && run.status === 'PASSED' && run.nextStep === variant.steps.length && run.pendingStep === undefined && !!run.finishedAt).map(run => run.id))];
  const verified = variant.status === 'VERIFIED' && !!variant.verifiedRunId && verifiedRunIds.includes(variant.verifiedRunId) && verifiedRunIds.length >= 3;
  const workflow = new DemonstrationLearningEngine().inferWorkflow(`candidate:${variant.id}`,events);
  return {variantId:variant.id,sourceDigest:digest,state:incomplete || failed ? 'NEEDS_VALIDATION' : verified ? 'VALIDATED' : 'OBSERVED',correctionState:'UNKNOWN',executable:false,verifiedRunIds,workflow};
}

/** Shared by the actual owner-authenticated route and integration tests. */
export async function teachingLibraryResponse(authorize: () => Promise<boolean>, getStore: () => TeachingStore, project?: (store: TeachingStore) => unknown): Promise<Response> {
  const headers = {'Cache-Control':'no-store'};
  try {
    if (!await authorize()) return Response.json({message:'オーナー認証が必要です'},{status:401,headers});
    const store = getStore();
    if (project) return Response.json(project(store),{headers});
    const snapshot = store.list();
    if (snapshot.variants.length > 500 || snapshot.runs.length > 2000 || snapshot.variants.some(v => v.steps.length > 50)) throw Error('Teaching capacity exceeded');
    const learningCandidates = snapshot.variants.map(variant => teachingLearningCandidate(variant,snapshot.runs));
    return Response.json({...snapshot,learningCandidates},{headers});
  } catch {
    return Response.json({message:'手順ストアを読めません'},{status:503,headers});
  }
}
