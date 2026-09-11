export interface ProportionInterval {
  estimate: number;
  lower: number;
  upper: number;
  n: number;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): ProportionInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new Error("successes and total must be valid non-negative integer counts with total > 0");
  }
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return { estimate: p, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin), n: total };
}

export interface PairedBinaryOutcome {
  id: string;
  before: boolean;
  after: boolean;
}

export interface PairedBinaryComparison {
  total: number;
  beforeRate: number;
  afterRate: number;
  delta: number;
  improved: number;
  regressed: number;
  unchangedPass: number;
  unchangedFail: number;
  netImprovement: number;
}

export function comparePairedBinary(outcomes: readonly PairedBinaryOutcome[]): PairedBinaryComparison {
  if (!outcomes.length) throw new Error("paired comparison requires at least one outcome");
  let improved = 0;
  let regressed = 0;
  let unchangedPass = 0;
  let unchangedFail = 0;
  for (const item of outcomes) {
    if (!item.before && item.after) improved += 1;
    else if (item.before && !item.after) regressed += 1;
    else if (item.before) unchangedPass += 1;
    else unchangedFail += 1;
  }
  const beforePasses = regressed + unchangedPass;
  const afterPasses = improved + unchangedPass;
  return {
    total: outcomes.length,
    beforeRate: beforePasses / outcomes.length,
    afterRate: afterPasses / outcomes.length,
    delta: (afterPasses - beforePasses) / outcomes.length,
    improved,
    regressed,
    unchangedPass,
    unchangedFail,
    netImprovement: improved - regressed,
  };
}

export function sampleSizeWarning(total: number, minimum = 30): string | null {
  return total < minimum ? `Sample size ${total} is below the configured minimum ${minimum}.` : null;
}

export function repeatRunVariance(values: readonly number[]): { mean: number; variance: number; standardDeviation: number } {
  if (!values.length) throw new Error("repeat-run variance requires at least one value");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, variance, standardDeviation: Math.sqrt(variance) };
}
