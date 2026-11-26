export function allowedRepairPaths(prPaths: string[]): string[];
export function isTestPath(path: string): boolean;
export function isSameRepositoryOpenPullRequest(pr: {
  state: string;
  head: { ref: string; repo?: { full_name?: string } | null };
  base: { ref: string; repo?: { full_name?: string } | null };
}, repository: string): boolean;
