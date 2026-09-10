import type { LearningRecord, Observation, Prediction } from "./types.ts";

export function learnFromOutcome(
  prediction: Prediction,
  observation: Observation,
): LearningRecord {
  const lesson = observation.success
    ? `Action succeeded: ${prediction.action}`
    : `Prediction error for ${prediction.action}: expected "${prediction.expectedOutcome}" but observed "${observation.actualOutcome}".`;

  const transferableRule = observation.success
    ? `When comparable preconditions hold, consider reusing the strategy: ${prediction.action}`
    : `Before retrying comparable tasks, test the assumption behind: ${prediction.expectedOutcome}`;

  return { prediction, observation, lesson, transferableRule };
}

export function shouldPromoteRule(record: LearningRecord): boolean {
  return record.observation.evidence.length > 0 && record.prediction.confidence >= 0.5;
}
