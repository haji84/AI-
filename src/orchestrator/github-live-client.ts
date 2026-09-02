import type { GitHubReadClient } from "./github-capability.ts";

export interface GitHubRuntimeConfig {
  token: string | null;
  repository: string;
  apiBaseUrl: string;
}

export interface GitHubTransport {
  get(path: string, token: string): Promise<unknown>;
}

export function githubRuntimeConfig(env: NodeJS.ProcessEnv = process.env): GitHubRuntimeConfig {
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

    return {
      available: true,
      repository: this.config.repository,
      repositoryState: repository,
      openIssues: issues,
      openPullRequests: pulls,
      recentWorkflowRuns: runs,
    };
  }
}
