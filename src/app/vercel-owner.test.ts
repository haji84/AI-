import assert from "node:assert/strict";
import test from "node:test";
import {
  getVercelOwnerStatus,
  isManagedSecretKey,
  redactVercelResult,
  redeployLatestProduction,
  updateManagedSecret,
  vercelOwnerConfigFromEnv,
} from "./vercel-owner.ts";

const config = { token: "secret-token", projectId: "prj_test", accountId: "team_test" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Vercel owner config fails closed when token or project is missing", () => {
  assert.equal(vercelOwnerConfigFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.deepEqual(vercelOwnerConfigFromEnv({ AI_COMPANY_VERCEL_TOKEN: "t", AI_COMPANY_VERCEL_PROJECT_ID: "p" } as unknown as NodeJS.ProcessEnv), {
    token: "t",
    projectId: "p",
    accountId: null,
  });
});

test("managed secret allowlist does not permit arbitrary environment variables", () => {
  assert.equal(isManagedSecretKey("AI_COMPANY_GITHUB_TOKEN"), true);
  assert.equal(isManagedSecretKey("VERCEL_TOKEN"), false);
  assert.equal(isManagedSecretKey("DATABASE_URL"), false);
});

test("redaction removes secret-like fields recursively", () => {
  assert.deepEqual(redactVercelResult({ token: "a", nested: { value: "b", ok: 1 }, authorization: "c" }), {
    token: "[REDACTED]",
    nested: { value: "[REDACTED]", ok: 1 },
    authorization: "[REDACTED]",
  });
});

test("status is scoped to configured project and production deployments", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/v9/projects/")) return jsonResponse({ id: "prj_test", name: "unified-ai-creator-studio" });
    return jsonResponse({ deployments: [{ uid: "dpl_1", url: "example.vercel.app", readyState: "READY", target: "production", created: Date.parse("2026-09-12T00:00:00Z") }] });
  };
  const result = await getVercelOwnerStatus(config, fetchImpl);
  assert.equal(result.project.id, "prj_test");
  assert.equal(result.deployments[0]?.id, "dpl_1");
  assert.ok(calls.every((url) => url.includes("teamId=team_test")));
});

test("production redeploy reuses only latest scoped deployment id", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("/v7/deployments")) return jsonResponse({ deployments: [{ uid: "dpl_source", readyState: "READY", url: "old.vercel.app" }] });
    if (url.includes("/v13/deployments")) return jsonResponse({ id: "dpl_new", readyState: "BUILDING", url: "new.vercel.app" });
    return jsonResponse({});
  };
  const result = await redeployLatestProduction(config, fetchImpl);
  assert.equal(result.sourceDeploymentId, "dpl_source");
  assert.equal(result.deploymentId, "dpl_new");
  assert.match(requests.at(-1)?.body ?? "", /dpl_source/);
});

test("managed secret update patches matching envs without returning secret value", async () => {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/v10/projects/") && url.includes("/env") && !init?.method) {
      return jsonResponse({ envs: [{ id: "env_prod", key: "AI_COMPANY_GITHUB_TOKEN", target: ["production"] }] });
    }
    if (init?.body && typeof init.body === "string") bodies.push(init.body);
    return jsonResponse({ ok: true });
  };
  const result = await updateManagedSecret(config, "AI_COMPANY_GITHUB_TOKEN", "new-secret", fetchImpl);
  assert.equal(result.secretExposed, false);
  assert.equal("value" in result, false);
  assert.match(bodies[0] ?? "", /new-secret/);
});
