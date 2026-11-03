import { posix } from "node:path";

export interface RepositoryDevelopmentEntry {
  path: string;
  content: string;
}
export interface RepositoryDevelopmentContextItem {
  path: string;
  summary: string;
}

export interface RepositoryDevelopmentContext {
  objective: string;
  selectedPaths: string[];
  items: RepositoryDevelopmentContextItem[];
  symbols: string[];
  imports: string[];
  requirementIds: string[];
  relatedTests: string[];
  truncated: boolean;
}

export interface RepositoryDevelopmentContextInput {
  objective: string;
  preferredFiles: string[];
  entries: RepositoryDevelopmentEntry[];
  maxChars?: number;
}

function canonicalPath(value: string): string {
  return posix.normalize(value.replaceAll("\\", "/"));
}

function relativeImports(entry: RepositoryDevelopmentEntry): string[] {
  const imports = [...entry.content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]!);
  return imports.filter((value) => value.startsWith(".")).map((value) => canonicalPath(posix.join(posix.dirname(entry.path), value)));
}

function isTestPath(path: string): boolean {
  return path.startsWith("tests/") || /(?:^|\/)__tests__\//.test(path) || /\.(?:test|spec)\.[^.]+$/.test(path);
}

export function buildRepositoryDevelopmentContext(input: RepositoryDevelopmentContextInput): RepositoryDevelopmentContext {
  const maxChars = input.maxChars ?? 40_000;
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("repository context maxChars must be positive");
  const entries = new Map(input.entries.map((entry) => [canonicalPath(entry.path), { ...entry, path: canonicalPath(entry.path) }]));
  const preferred = [...new Set(input.preferredFiles.map(canonicalPath))].filter((path) => entries.has(path));
  const dependencies = preferred.flatMap((path) => relativeImports(entries.get(path)!)).filter((path) => entries.has(path));
  const relatedTests = [...entries.values()]
    .filter((entry) => isTestPath(entry.path))
    .filter((entry) => preferred.some((path) => entry.content.includes(path) || entry.content.includes(posix.basename(path))))
    .map((entry) => entry.path)
    .sort();
  const selectedPaths = [...new Set([...preferred, ...dependencies, ...relatedTests])];

  let remaining = maxChars;
  let truncated = false;
  const items = selectedPaths.map((path) => {
    const content = entries.get(path)!.content;
    const summary = content.slice(0, Math.max(0, remaining));
    remaining -= summary.length;
    if (summary.length < content.length) truncated = true;
    return { path, summary };
  }).filter((item) => item.summary.length > 0);
  if (items.length < selectedPaths.length) truncated = true;

  const selectedContent = selectedPaths.map((path) => entries.get(path)?.content ?? "").join("\n");
  const symbols = [...new Set([...selectedContent.matchAll(/\b(?:class|function|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!))].sort();
  const imports = [...new Set(selectedPaths.flatMap((path) => relativeImports(entries.get(path)!)))].sort();
  const requirementIds = [...new Set([...`${input.objective}\n${selectedContent}`.matchAll(/\b[A-Z][A-Z0-9-]*-\d{3}\b/g)].map((match) => match[0]))].sort();

  return { objective: input.objective, selectedPaths, items, symbols, imports, requirementIds, relatedTests, truncated };
}
