import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowSource = new URL("../.github/workflows/vercel-scoped-production-deploy.yml", import.meta.url);
const routeSource = new URL("../src/app/api/command/route.ts", import.meta.url);
const safePrSource = new URL("../src/orchestrator/safe-pr-capability.ts", import.meta.url);
const agentsSource = new URL("../AGENTS.md", import.meta.url);

test("Production self-driving path is exact-task scoped and fail-closed", async () => {
  const [workflow, route, safePr, agents] = await Promise.all([
    readFile(workflowSource, "utf8"),
    readFile(routeSource, "utf8"),
    readFile(safePrSource, "utf8"),
    readFile(agentsSource, "utf8"),
  ]);

  assert.match(route, /requestsProductionDeploy/);
  assert.match(route, /production-deploy-authorized: \$\{productionDeployRequested \? "true" : "false"\}/);
  assert.match(route, /productionDeployAuthorized:/);

  assert.match(safePr, /ai-company-task-scope:/);
  assert.match(safePr, /ai-company-production-deploy: approved/);
  assert.match(safePr, /ai-company-task-authorization-expires-at:/);

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /merge_commit_sha === sha/);
  assert.match(workflow, /production-deploy-authorized:\\s\*true/);
  assert.match(workflow, /completionInstruction/);
  assert.match(workflow, /expiresAt <= Date\.now\(\)/);
  assert.match(workflow, /ref: \$\{\{ needs\.authorize\.outputs\.deploy_sha \}\}/);
  assert.match(workflow, /if: needs\.authorize\.outputs\.authorized == 'true'/);

  assert.match(agents, /completion instruction such as `完成させて`/i);
  assert.match(agents, /Production deployment of the exact merged commit/i);
  assert.match(agents, /It never authorizes secrets or credentials/i);
  assert.match(agents, /non-completion instruction such as `進めて`/i);
});
