export function changedPaths(porcelain: string): string[] {
  return porcelain.split(/\r?\n/).filter(line => line.length >= 4).map(line => line.slice(3));
}

export function newPathsSinceBaseline(baseline: string[], current: string[]): string[] {
  const before = new Set(baseline);
  return current.filter(path => !before.has(path));
}

export function terminalWorkPhase(phase: string | undefined): boolean {
  return ["COMPLETED", "BLOCKED", "HUMAN_GATE", "FAILED"].includes(phase ?? "");
}
