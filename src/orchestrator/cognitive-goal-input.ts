import { cognitiveLearningText } from "../gai/cognitive-learning.ts";
export interface CognitiveGoalRefinement {
  goalId: string;
  goalDigest: string;
  successCriteria: string[];
  acknowledgement: true;
}

const INPUT_FIELDS = ["goalId", "goalDigest", "successCriteria", "acknowledgement"];
/** Caller text can provide criteria only; all other Goal fields come from Compass. */
export function validateCognitiveGoalRefinement(value: unknown): CognitiveGoalRefinement {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !INPUT_FIELDS.includes(key))) throw Error("Invalid Goal refinement fields");
  const input = value as Record<string, unknown>;
  if (typeof input.goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(input.goalId) || typeof input.goalDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.goalDigest)) throw Error("Invalid Goal refinement identity");
  if (input.acknowledgement !== true) throw Error("Goal criteria require explicit owner acknowledgement");
  if (!Array.isArray(input.successCriteria) || input.successCriteria.length < 1 || input.successCriteria.length > 16) throw Error("Goal criteria must contain 1 to 16 explicit outcomes");
  const successCriteria = Array.from(input.successCriteria, (criterion) => cognitiveLearningText(criterion, "success criterion", 500));
  if (new Set(successCriteria).size !== successCriteria.length) throw Error("Goal criteria must be distinct");
  return { goalId: input.goalId, goalDigest: input.goalDigest, successCriteria, acknowledgement: true };
}

export function validateCognitiveGoalProposalInput(value: unknown): { goalId: string; goalDigest: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || Object.keys(value).some(k => !["goalId", "goalDigest"].includes(k))) throw Error("Invalid Goal proposal fields");
  const input = value as Record<string, unknown>;
  if (typeof input.goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(input.goalId) || typeof input.goalDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.goalDigest)) throw Error("Invalid Goal proposal identity");
  return { goalId: input.goalId, goalDigest: input.goalDigest };
}
