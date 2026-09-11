export interface CalibrationObservation {
  id: string;
  confidence: number;
  occurred: boolean;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  empiricalRate: number;
  absoluteGap: number;
}

export interface CalibrationReport {
  count: number;
  brierScore: number;
  expectedCalibrationError: number;
  bins: CalibrationBin[];
}

export function evaluateCalibration(observations: readonly CalibrationObservation[], binCount = 10): CalibrationReport {
  if (!observations.length) throw new Error("calibration requires observations");
  if (!Number.isInteger(binCount) || binCount <= 0) throw new Error("binCount must be a positive integer");
  for (const item of observations) {
    if (item.confidence < 0 || item.confidence > 1 || !Number.isFinite(item.confidence)) {
      throw new Error(`invalid confidence for ${item.id}`);
    }
  }

  const brierScore = observations.reduce((sum, item) => sum + (item.confidence - (item.occurred ? 1 : 0)) ** 2, 0) / observations.length;
  const bins: CalibrationBin[] = [];
  for (let index = 0; index < binCount; index += 1) {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    const members = observations.filter((item) => item.confidence >= lower && (index === binCount - 1 ? item.confidence <= upper : item.confidence < upper));
    if (!members.length) continue;
    const meanConfidence = members.reduce((sum, item) => sum + item.confidence, 0) / members.length;
    const empiricalRate = members.filter((item) => item.occurred).length / members.length;
    bins.push({ lower, upper, count: members.length, meanConfidence, empiricalRate, absoluteGap: Math.abs(meanConfidence - empiricalRate) });
  }
  const expectedCalibrationError = bins.reduce((sum, bin) => sum + (bin.count / observations.length) * bin.absoluteGap, 0);
  return { count: observations.length, brierScore, expectedCalibrationError, bins };
}
