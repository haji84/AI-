import type { GitHubReadClient } from "./github-capability.ts";

export interface GitHubRuntimeConfig {
  token: string | null;
  repository: string;
  apiBaseUrl: string;
}

export interface GitHubTransport {
  get(path: string, token: string): Promise<unknown>;
}

export interface CollectionDiagnostic {
  count: number;
  sourceShape: string;
  recovered: boolean;
}

function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("[") || trimmed.startsWith("{"))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function normalizeGitHubCollection(value: unknown): { items: unknown[]; diagnostic: CollectionDiagnostic } {
  const initialShape = shapeOf(value);
  let current = value;

  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(current)) {
      return {
        items: current,
        diagnostic: { count: current.length, sourceShape: depth === 0 ? "array" : `${initialShape}->array`, recovered: depth > 0 },
      };
    }

    if (typeof current === "string") {
      const parsed = parseJsonString(current);
      if (parsed === undefined) break;
      current = parsed;
      continue;
    }

    if (!current || typeof current !== "object") break;
    const wrapped = current as Record<string, unknown>;
    if (Array.isArray(wrapped.items)) {
      current = wrapped.items;
      continue;
    }
    if (Array.isArray(wrapped.data)) {
      current = wrapped.data;
      continue;
    }
    if (Array.isArray(wrapped.workflow_runs)) {
      current = wrapped.workflow_runs;
      continue;
    }
    if (typeof wrapped.content === "string" || Array.isArray(wrapped.content) || (wrapped.content && typeof wrapped.content === "object")) {
      current = wrapped.content;
      continue;
    }
    if (wrapped.structuredContent && typeof wrapped.structuredContent === "object") {
      const structured = wrapped.structuredContent as Record<string, unknown>;
      if (structured.content !== undefined) {
        current = structured.content;
        continue;
      }
    }
    break;
  }

  return {
    items: [],
    diagnostic: { count: 0, sourceShape: initialShape, recovered: false },
  };
}

export function githubRuntimeConfig(env: Record<string, string | undefined> = process.env): GitHubRuntimeConfig {
  const repository = env.GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  return {
    token: env.GITHUB_TOKEN?.trim() || null,
    repository,
    apiBaseUrl: env.GITHUB_API_URL?.trim() || "https://api.github.com",
  };
}

export class FetchGitHubTransport implements GitHubTransport {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://api.github.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async get(path: string, token: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  }
}

export class LiveGitHubReadClient implements GitHubReadClient {
  private readonly config: GitHubRuntimeConfig;
  private readonly transport: GitHubTransport;

  constructor(config = githubRuntimeConfig(), transport?: GitHubTransport) {
    this.config = config;
    this.transport = transport ?? new FetchGitHubTransport(config.apiBaseUrl);
  }

  async readRepositoryState(): Promise<unknown> {
    if (!this.config.token) {
      return { available: false, reason: "not_connected", repository: this.config.repository };
    }

    const repoPath = `/repos/${this.config.repository}`;
    const [repository, issues, pulls, runs] = await Promise.all([
      this.transport.get(repoPath, this.config.token),
      this.transport.get(`${repoPath}/issues?state=open&per_page=20`, this.config.token),
      this.transport.get(`${repoPath}/pulls?state=open&per_page=20`, this.config.token),
      this.transport.get(`${repoPath}/actions/runs?per_page=10`, this.config.token),
    ]);

    const normalizedIssues = normalizeGitHubCollection(issues);
    const normalizedPulls = normalizeGitHubCollection(pulls);
    const normalizedRuns = normalizeGitHubCollection(runs);

    return {
      available: true,
      repository: this.config.repository,
      repositoryState: repository,
      openIssues: normalizedIssues.items,
      openPullRequests: normalizedPulls.items,
      recentWorkflowRuns: normalizedRuns.items,
      collectionDiagnostics: {
        openIssues: normalizedIssues.diagnostic,
        openPullRequests: normalizedPulls.diagnostic,
        recentWorkflowRuns: normalizedRuns.diagnostic,
      },
    };
  }
}
