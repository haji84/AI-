import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { ContextItem, ContextSource, Goal } from "./goal-loop.ts";

const DEFAULT_REPOSITORY_FILES = ["PROJECT_STATE.md", "ROADMAP.md", "package.json"] as const;

export class RepositoryFileContextSource implements ContextSource {
  readonly name = "repository-files";
  private readonly root: string;
  private readonly files: readonly string[];

  constructor(options: { root?: string; files?: readonly string[] } = {}) {
    this.root = options.root ?? process.cwd();
    this.files = options.files ?? DEFAULT_REPOSITORY_FILES;
  }

  async collect(): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    for (const file of this.files) {
      try {
        const content = await readFile(resolve(this.root, file), "utf-8");
        items.push({ source: `repository.file:${file}`, summary: content.slice(0, 4000), data: { file } });
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "unknown";
        items.push({ source: `repository.file:${file}`, summary: `unavailable:${code}`, data: { file, available: false } });
      }
    }
    return items;
  }
}

const WORKSPACE_ROOTS = ["src", "tests", "docs", "scripts"] as const;
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json", ".yml", ".yaml", ".css"]);
const FORBIDDEN_WORKSPACE_FILES = new Set(["AGENTS.md", "PROJECT_STATE.md", "ROADMAP.md", "package.json", "pnpm-lock.yaml"]);
const MAX_INDEX_FILES = 240;
const MAX_SELECTED_FILES = 8;
const MAX_FILE_BYTES = 12_000;
const MAX_TOTAL_BYTES = 48_000;

function queryTokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])]
    .filter((token) => !["the", "and", "with", "from", "this", "that", "issue", "phase", "cloud", "safe"].includes(token));
}

function pathScore(path: string, tokens: string[]): number {
  const lower = path.toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) return;
      const absolute = resolve(directory, entry.name);
      const repoPath = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (["node_modules", ".git", ".next", "tmp", "dist", "coverage"].includes(entry.name)) continue;
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || FORBIDDEN_WORKSPACE_FILES.has(repoPath) || repoPath.startsWith(".github/")) continue;
      if (!WORKSPACE_ROOTS.some((prefix) => repoPath === prefix || repoPath.startsWith(`${prefix}/`))) continue;
      if (!TEXT_EXTENSIONS.has(extname(repoPath).toLowerCase())) continue;
      files.push(repoPath);
    }
  };

  for (const prefix of WORKSPACE_ROOTS) {
    const directory = resolve(root, prefix);
    try {
      if ((await stat(directory)).isDirectory()) await visit(directory);
    } catch {
      // Missing optional workspace roots are ignored.
    }
  }
  return files;
}

export class BoundedWorkspaceReader {
  private readonly root: string;

  constructor(options: { root?: string } = {}) {
    this.root = options.root ?? process.cwd();
  }

  async collect(query: string): Promise<ContextItem[]> {
    const index = await listWorkspaceFiles(this.root);
    const tokens = queryTokens(query);
    const ranked = [...index].sort((a, b) => pathScore(b, tokens) - pathScore(a, tokens) || a.localeCompare(b));
    const files: Array<{ path: string; content: string }> = [];
    let totalBytes = 0;

    for (const path of ranked) {
      if (files.length >= MAX_SELECTED_FILES || totalBytes >= MAX_TOTAL_BYTES) break;
      const absolute = resolve(this.root, path);
      if (!absolute.startsWith(resolve(this.root) + "/")) continue;
      try {
        const info = await stat(absolute);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
        const content = await readFile(absolute, "utf-8");
        if (content.includes("\u0000")) continue;
        const bytes = Buffer.byteLength(content, "utf-8");
        if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) continue;
        files.push({ path, content });
        totalBytes += bytes;
      } catch {
        // Racy file changes or unreadable files are simply skipped.
      }
    }

    return [{
      source: "repository.workspace",
      summary: `Bounded repository source context: ${files.length} files, ${totalBytes} bytes; index=${index.slice(0, MAX_INDEX_FILES).join(", ")}`.slice(0, 12000),
      data: { files, index, limits: { maxFiles: MAX_SELECTED_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES } },
    }];
  }
}

export interface ExternalContextConnector {
  name: string;
  available(): Promise<boolean>;
  collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]>;
}

export class SafeConnectorContextSource implements ContextSource {
  readonly name: string;
  private readonly connector: ExternalContextConnector;

  constructor(connector: ExternalContextConnector) {
    this.connector = connector;
    this.name = `connector:${connector.name}`;
  }

  async collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]> {
    if (!(await this.connector.available())) {
      return [{
        source: this.name,
        summary: "connector_unavailable",
        data: { connector: this.connector.name, available: false },
      }];
    }
    return this.connector.collect(input);
  }
}
