import { cognitiveActionFingerprint } from "./cognitive-core.ts";
import { CognitiveLearningEngine, type CognitiveLearningPartition } from "./cognitive-learning.ts";
import { CognitiveLocalOutcomeCatalog } from "./cognitive-local-outcomes.ts";
import { type CognitiveEvaluationPlan } from "./cognitive-evaluation.ts";

/** Host-only preparation. Execution remains with the existing Core/WorkState authority. */
export async function prepareCognitiveSkillEvaluation(input: {
  learning: CognitiveLearningEngine; partition: CognitiveLearningPartition; skillId: string; id: string;
  baseline: { catalog: CognitiveLocalOutcomeCatalog; goalId: string };
  candidate: { catalog: CognitiveLocalOutcomeCatalog; goalId: string };
}): Promise<CognitiveEvaluationPlan[]> {
  if (!(input.learning instanceof CognitiveLearningEngine) || !(input.baseline.catalog instanceof CognitiveLocalOutcomeCatalog) || !(input.candidate.catalog instanceof CognitiveLocalOutcomeCatalog)) throw Error("Matched evaluation requires existing local catalogs and private ledger");
  const subject = await input.learning.localSkillSubject(input.partition, input.skillId);
  const arms = [input.baseline, input.candidate], descriptors = await Promise.all(arms.map(a => a.catalog.skillEvaluationDescriptor()));
  const roots = await Promise.all(arms.map(a => a.catalog.evaluationDataRoot()));
  if (descriptors[0].scenarioDigest !== descriptors[1].scenarioDigest || roots[0] === roots[1] || arms[0].catalog.contractDigest === arms[1].catalog.contractDigest ||
      descriptors.some(d => d.candidates.filter(c => c.action.capability !== "cognitive.material.read").some(c => c.learningOperation !== subject.operation))) throw Error("Matched evaluation requires equal Goals, sources, operations and oracle criteria in distinct data roots");
  const plans: CognitiveEvaluationPlan[] = arms.map((a, i) => ({ version: 1, id: `${input.id}:${i ? "candidate" : "baseline"}`, partition: input.partition,
    goalId: a.goalId, goalDigest: a.catalog.evaluationGoalDigest, environment: subject.environment, contractDigest: a.catalog.contractDigest,
    materialSha256: descriptors[i].materialSha256, actions: descriptors[i].candidates.map(c => ({ actionId: c.id, fingerprint: cognitiveActionFingerprint({ ...c.action, completesBoundedCommand: false }), artifacts: descriptors[i].artifacts[c.id] })),
    oracle: "local-source-derived-exact-v1", comparison: { id: input.id, arm: i ? "candidate" : "baseline", skillId: subject.skillId,
      skillVersion: subject.skillVersion, skillDigest: subject.skillDigest, scenarioDigest: descriptors[i].scenarioDigest } }));
  const existing = await Promise.all(plans.map(p => input.learning.evaluationReservation(input.partition, p.goalId, p.id)));
  // Exact replay after execution needs no new pristine-target requirement. The ledger
  // checks the complete original plans; a new pair must inspect both before allocation.
  if (!existing.some(Boolean)) await Promise.all(arms.map(a => a.catalog.assertEvaluationPristine()));
  return input.learning.allocateSkillEvaluation(plans);
}
