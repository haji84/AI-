export function changedPaths(porcelain: string): string[] {
  return porcelain.split(/\r?\n/).filter(line => line.length >= 4).map(line => line.slice(3));
}
