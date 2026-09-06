export interface ApprovalReadiness {
  ready: boolean;
  ownerSecretConfigured: boolean;
  githubTokenConfigured: boolean;
  repository: string;
  missing: string[];
}

export function approvalReadinessFromEnv(env: NodeJS.ProcessEnv = process.env): ApprovalReadiness {
  const ownerSecretConfigured = Boolean(env.AI_COMPANY_OWNER_SECRET?.trim());
  const githubTokenConfigured = Boolean(env.AI_COMPANY_GITHUB_TOKEN?.trim());
  const repository = env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  const missing: string[] = [];
  if (!ownerSecretConfigured) missing.push("オーナー認証コード");
  if (!githubTokenConfigured) missing.push("GitHub承認トークン");
  return {
    ready: missing.length === 0,
    ownerSecretConfigured,
    githubTokenConfigured,
    repository,
    missing,
  };
}
