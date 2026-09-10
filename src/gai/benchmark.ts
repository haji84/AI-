export interface BenchmarkCaseResult {
  id: string;
  passed: boolean;
  humanInterventionCount: number;
  durationMs: number;
  transferTask?: boolean;
}

export interface BenchmarkSummary {
  total: number;
  passed: number;
  successRate: number;
  humanInterventionRate: number;
  transferSuccessRate: number | null;
  averageDurationMs: number;
}

export function summarizeBenchmark(results: BenchmarkCaseResult[]): BenchmarkSummary {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      passed: 0,
      successRate: 0,
      humanInterventionRate: 0,
      transferSuccessRate: null,
      averageDurationMs: 0,
    };
  }

  const passed = results.filter((result) => result.passed).length;
  const interventions = results.reduce((sum, result) => sum + result.humanInterventionCount, 0);
  const transfer = results.filter((result) => result.transferTask);
  const transferPassed = transfer.filter((result) => result.passed).length;

  return {
    total,
    passed,
    successRate: passed / total,
    humanInterventionRate: interventions / total,
    transferSuccessRate: transfer.length > 0 ? transferPassed / transfer.length : null,
    averageDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0) / total,
  };
}

export function meetsInitialGaiTarget(summary: BenchmarkSummary): boolean {
  return summary.total >= 100 && summary.successRate >= 0.8 && summary.humanInterventionRate < 0.1;
}
