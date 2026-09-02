import type { ManagedCapabilityHandler } from "./capability-policy.ts";

export interface GitHubReadClient {
  readRepositoryState(): Promise<unknown>;
}

export function createGitHubReadCapability(client: GitHubReadClient): ManagedCapabilityHandler {
  return {
    name: "github.read_repository_state",
    metadata: {
      access: "read",
      externalSideEffect: false,
      risk: "low",
      requiresHumanApproval: false,
    },
    async execute(action) {
      try {
        const state = await client.readRepositoryState();
        return {
          actionId: action.id,
          ok: true,
          summary: "GitHub repository state read successfully",
          evidence: { state },
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "unknown GitHub read error";
        return {
          actionId: action.id,
          ok: false,
          summary: `GitHub repository state unavailable: ${message}`,
          blocker: "github_read_unavailable",
        };
      }
    },
  };
}
