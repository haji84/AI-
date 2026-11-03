import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { createDevelopmentJob } from "../src/orchestrator/development-job.ts";
import { HttpDevelopmentReleaseCapability } from "../src/orchestrator/http-development-release-capability.ts";

const job = createDevelopmentJob({ jobId: "j", goalId: "g", requirementIds: ["CORE-014"], acceptanceCriteria: ["done"], definitionOfDone: [{ id: "d", description: "done", required: true }], baseRevision: "a".repeat(40), approvalScope: { taskScopeId: "issue:681", maxRisk: "medium" }, workItems: [{ id: "w", objective: "work", dependsOn: [], requiredCapabilities: [] }] });
const changeSet = createDevelopmentChangeSet({ changeSetId: "c", jobId: "j", workItemId: "w", deviceId: "builder", baseRevision: "a".repeat(40), changedPaths: ["src/a.ts"], affectedSymbols: [], patchDigest: "b".repeat(64), evidenceDigest: "c".repeat(64), rollback: { kind: "git-base", reference: "a".repeat(40) } });

test("HTTP release capability binds state and idempotent effects to the durable Job", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const capability = new HttpDevelopmentReleaseCapability({ url: "https://release.example", token: "token" }, async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("/state?")) return new Response(JSON.stringify({ connected: true, taskScopeId: "issue:681", protectedConditions: [], classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal((await capability.state({ job, changeSet })).taskScopeId, "issue:681");
  await capability.execute("OPEN_PR", { operationId: "j:OPEN_PR:c", job, changeSet, goal: { title: "g", successCriteria: ["done"], constraints: [] }, context: [] });
  assert.equal(new Headers(calls[1]!.init?.headers).get("Idempotency-Key"), "j:OPEN_PR:c");
  assert.match(String(calls[1]!.init?.body), /"taskScopeId":"issue:681"/);
});
