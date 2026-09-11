export interface ReplicationMetric {
  name: string;
  original: number;
  replicated: number;
  tolerance: number;
}

export interface ReplicationReport {
  metrics: Array<ReplicationMetric & { delta: number; withinTolerance: boolean }>;
  allWithinTolerance: boolean;
  maximumAbsoluteDelta: number;
}

export function evaluateReplication(metrics: readonly ReplicationMetric[]): ReplicationReport {
  if (!metrics.length) throw new Error("replication evaluation requires metrics");
  const evaluated = metrics.map((metric) => {
    if (metric.tolerance < 0 || !Number.isFinite(metric.tolerance)) throw new Error(`invalid tolerance for ${metric.name}`);
    const delta = metric.replicated - metric.original;
    return { ...metric, delta, withinTolerance: Math.abs(delta) <= metric.tolerance };
  });
  return {
    metrics: evaluated,
    allWithinTolerance: evaluated.every((item) => item.withinTolerance),
    maximumAbsoluteDelta: Math.max(...evaluated.map((item) => Math.abs(item.delta))),
  };
}
