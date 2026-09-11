export type VercelOwnerConfig = {
  token: string;
  projectId: string;
  accountId: string | null;
};

export type VercelOwnerFetch = typeof fetch;

export const MANAGED_SECRET_KEYS = ["AI_COMPANY_GITHUB_TOKEN"] as const;
export type ManagedSecretKey = typeof MANAGED_SECRET_KEYS[number];

function apiUrl(path: string, config: VercelOwnerConfig): string {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.accountId?.startsWith("team_")) url.searchParams.set("teamId", config.accountId);
  return url.toString();
}

function headers(config: VercelOwnerConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
}

async function vercelJson<T>(fetchImpl: VercelOwnerFetch, config: VercelOwnerConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchImpl(apiUrl(path, config), {
    ...init,
    headers: { ...headers(config), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : `Vercel HTTP ${response.status}`;
    throw new Error(`${response.status}: ${message}`);
  }
  return payload as T;
}

export function vercelOwnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VercelOwnerConfig | null {
  const token = env.AI_COMPANY_VERCEL_TOKEN?.trim() || "";
  const projectId = env.AI_COMPANY_VERCEL_PROJECT_ID?.trim() || "";
  const accountId = env.AI_COMPANY_VERCEL_ACCOUNT_ID?.trim() || null;
  if (!token || !projectId) return null;
  return { token, projectId, accountId };
}

export function isManagedSecretKey(value: unknown): value is ManagedSecretKey {
  return typeof value === "string" && (MANAGED_SECRET_KEYS as readonly string[]).includes(value);
}

export function redactVercelResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactVercelResult);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|value|authorization/i.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactVercelResult(child);
    }
  }
  return output;
}

export async function getVercelOwnerStatus(config: VercelOwnerConfig, fetchImpl: VercelOwnerFetch = fetch) {
  const project = await vercelJson<{ id: string; name: string; accountId?: string }>(fetchImpl, config, `/v9/projects/${encodeURIComponent(config.projectId)}`);
  const deployments = await vercelJson<{ deployments?: Array<{ uid?: string; id?: string; url?: string; state?: string; readyState?: string; target?: string; created?: number }> }>(
    fetchImpl,
    config,
    `/v7/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=5`,
  );
  return {
    configured: true,
    project: { id: project.id, name: project.name },
    deployments: (deployments.deployments ?? []).map((deployment) => ({
      id: deployment.uid ?? deployment.id ?? null,
      url: deployment.url ?? null,
      state: deployment.readyState ?? deployment.state ?? null,
      target: deployment.target ?? null,
      createdAt: typeof deployment.created === "number" ? new Date(deployment.created).toISOString() : null,
    })),
  };
}

async function latestProductionDeployment(config: VercelOwnerConfig, fetchImpl: VercelOwnerFetch) {
  const result = await vercelJson<{ deployments?: Array<{ uid?: string; id?: string; url?: string; state?: string; readyState?: string }> }>(
    fetchImpl,
    config,
    `/v7/deployments?projectId=${encodeURIComponent(config.projectId)}&target=production&limit=10`,
  );
  const deployment = (result.deployments ?? []).find((item) => (item.uid ?? item.id) && ["READY", "ERROR", "CANCELED"].includes(String(item.readyState ?? item.state ?? "").toUpperCase()))
    ?? (result.deployments ?? [])[0];
  if (!deployment) throw new Error("No Production deployment is available to redeploy");
  const id = deployment.uid ?? deployment.id;
  if (!id) throw new Error("Latest Production deployment has no id");
  return { id, url: deployment.url ?? null };
}

export async function redeployLatestProduction(config: VercelOwnerConfig, fetchImpl: VercelOwnerFetch = fetch) {
  const latest = await latestProductionDeployment(config, fetchImpl);
  const created = await vercelJson<{ id?: string; uid?: string; url?: string; readyState?: string; status?: string }>(fetchImpl, config, "/v13/deployments?forceNew=1", {
    method: "POST",
    body: JSON.stringify({ deploymentId: latest.id, target: "production" }),
  });
  return {
    sourceDeploymentId: latest.id,
    deploymentId: created.id ?? created.uid ?? null,
    url: created.url ?? null,
    state: created.readyState ?? created.status ?? null,
  };
}

export async function getLatestDeploymentDiagnostics(config: VercelOwnerConfig, fetchImpl: VercelOwnerFetch = fetch) {
  const latest = await latestProductionDeployment(config, fetchImpl);
  const deployment = await vercelJson<Record<string, unknown>>(fetchImpl, config, `/v13/deployments/${encodeURIComponent(latest.id)}?withGitRepoInfo=true`);
  const events = await vercelJson<unknown>(fetchImpl, config, `/v3/deployments/${encodeURIComponent(latest.id)}/events?direction=backward&follow=0&limit=40`);
  return redactVercelResult({ deployment, events });
}

export async function updateManagedSecret(
  config: VercelOwnerConfig,
  key: ManagedSecretKey,
  value: string,
  fetchImpl: VercelOwnerFetch = fetch,
) {
  if (!value.trim()) throw new Error("secret value must not be empty");
  const envs = await vercelJson<{ envs?: Array<{ id?: string; key?: string; target?: string[]; type?: string }> }>(
    fetchImpl,
    config,
    `/v10/projects/${encodeURIComponent(config.projectId)}/env`,
  );
  const matches = (envs.envs ?? []).filter((env) => env.key === key && env.id);
  const targets = ["production", "preview", "development"];
  if (matches.length) {
    for (const env of matches) {
      await vercelJson(fetchImpl, config, `/v9/projects/${encodeURIComponent(config.projectId)}/env/${encodeURIComponent(env.id!)}`, {
        method: "PATCH",
        body: JSON.stringify({ key, value, type: "sensitive", target: env.target?.length ? env.target : targets, comment: "Rotated by AI Company owner management" }),
      });
    }
  } else {
    await vercelJson(fetchImpl, config, `/v10/projects/${encodeURIComponent(config.projectId)}/env?upsert=true`, {
      method: "POST",
      body: JSON.stringify({ key, value, type: "sensitive", target: targets, comment: "Created by AI Company owner management" }),
    });
  }
  return { key, updated: Math.max(1, matches.length), targets, secretExposed: false };
}
