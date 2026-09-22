import { learnDemonstration, type DemoEvent } from "../orchestrator/demonstration-learning.ts";
import { profileKey, type TeachingVariant, type TeachingStep, type Observation } from "./teaching.ts";

export interface TeachingLearning {
  events: DemoEvent[];
  archive: Record<string, TeachingStep>;
  pendingCorrection?: { sourceSeq: number; signature: string; profileKey: string };
}

function journal(variant: TeachingVariant): TeachingLearning {
  if (variant.learning) return structuredClone(variant.learning);
  return {
    events: variant.steps.map((_, index) => ({ seq: index + 1, kind: "ACTION", operation: String(index + 1) })),
    archive: Object.fromEntries(variant.steps.map((step, index) => [String(index + 1), structuredClone(step)])),
  };
}

export function recordLearningStep(variant: TeachingVariant, step: TeachingStep): TeachingLearning {
  const state = journal(variant);
  if (state.pendingCorrection) throw Error("Finish correction before recording");
  if (state.events.length >= 500) throw Error("Learning observation capacity reached");
  const seq = state.events.length + 1;
  const kind = state.events.at(-1)?.kind === "ERROR" ? "RETRY" : "ACTION";
  state.events.push({ seq, kind, operation: String(seq) });
  state.archive[String(seq)] = structuredClone(step);
  return state;
}

export function requestLearningCorrection(variant: TeachingVariant): TeachingLearning {
  const state = journal(variant);
  if (state.pendingCorrection || state.events.length >= 500) throw Error("Correction unavailable");
  const previous = learnDemonstration(state.events, true).steps.at(-1);
  if (!previous) throw Error("No recorded action to correct");
  const step = state.archive[previous.operation];
  if (!step?.before) throw Error("Original screen evidence unavailable");
  state.pendingCorrection = { sourceSeq: previous.sourceSeq, signature: step.before, profileKey: step.contextKey ?? profileKey(variant.profile) };
  state.events.push({ seq: state.events.length + 1, kind: "ERROR", operation: "owner_marked_mistake" });
  return state;
}

export function correctedLearningSteps(variant: TeachingVariant, observed: Observation): TeachingStep[] | null {
  const pending = variant.learning?.pendingCorrection;
  if (!pending) throw Error("No pending correction");
  if (observed.protectedScreen || observed.profile.deviceId !== variant.profile.deviceId ||
      observed.signature !== pending.signature || profileKey(observed.profile) !== pending.profileKey) return null;
  return learnDemonstration(variant.learning!.events, true).steps.map(step => {
    const archived = variant.learning!.archive[step.operation];
    if (!archived) throw Error("Learning provenance missing");
    return structuredClone(archived);
  });
}
