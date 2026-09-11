export interface TaskScoreSnapshot {
  taskId: string;
  score: number;
}

export interface ContinualLearningReport {
  commonTasks: number;
  meanBefore: number;
  meanAfter: number;
  backwardTransfer: number;
  forgetting: number;
  improvedTasks: string[];
  regressedTasks: string[];
}

export function evaluateContinualLearning(
  before: readonly TaskScoreSnapshot[],
  after: readonly TaskScoreSnapshot[],
): ContinualLearningReport {
  const beforeMap = new Map(before.map((item) => [item.taskId, item.score]));
  const pairs = after
    .filter((item) => beforeMap.has(item.taskId))
    .map((item) => ({ taskId: item.taskId, before: beforeMap.get(item.taskId)!, after: item.score }));
  if (!pairs.length) throw new Error("continual-learning evaluation requires common tasks");
  const meanBefore = pairs.reduce((sum, item) => sum + item.before, 0) / pairs.length;
  const meanAfter = pairs.reduce((sum, item) => sum + item.after, 0) / pairs.length;
  const deltas = pairs.map((item) => item.after - item.before);
  const backwardTransfer = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const forgetting = pairs.reduce((sum, item) => sum + Math.max(0, item.before - item.after), 0) / pairs.length;
  return {
    commonTasks: pairs.length,
    meanBefore,
    meanAfter,
    backwardTransfer,
    forgetting,
    improvedTasks: pairs.filter((item) => item.after > item.before).map((item) => item.taskId),
    regressedTasks: pairs.filter((item) => item.after < item.before).map((item) => item.taskId),
  };
}

export function forwardTransfer(zeroShot: number, afterPriorLearning: number): number {
  if (![zeroShot, afterPriorLearning].every((value) => Number.isFinite(value))) throw new Error("transfer scores must be finite");
  return afterPriorLearning - zeroShot;
}
