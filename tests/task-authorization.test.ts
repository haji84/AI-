import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskCompletionAuthorization,
  isTaskCompletionAuthorizationActive,
  isTaskProductionDeployAuthorizationActive,
  requestsProductionDeploy,
  requestsTaskCompletion,
} from "../src/orchestrator/task-authorization.ts";

test("explicit completion language creates task-scoped merge and Production authorization", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const authorization = createTaskCompletionAuthorization(
    "Issue #243を最後まで進めて",
    { now, idFactory: () => "fixed" },
  );

  assert.equal(requestsTaskCompletion("Issue #243を最後まで進めて"), true);
  assert.equal(requestsProductionDeploy("Issue #243を最後まで進めて"), true);
  assert.equal(authorization?.scopeId, "issue:243");
  assert.equal(authorization?.allowLowMediumMainMerge, true);
  assert.equal(authorization?.allowProductionDeploy, true);
  assert.equal(authorization?.issuedBy, "owner");
  assert.equal(isTaskCompletionAuthorizationActive(authorization, "issue:243", now), true);
  assert.equal(isTaskProductionDeployAuthorizationActive(authorization, "issue:243", now), true);
});

test("generated fresh task completion binds Production authorization to its issue scope", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const authorization = createTaskCompletionAuthorization(
    "操作画面の文言を変更して完成させて",
    { now, scopeId: "issue:267", idFactory: () => "unused" },
  );

  assert.equal(authorization?.scopeId, "issue:267");
  assert.equal(authorization?.allowProductionDeploy, true);
  assert.equal(isTaskCompletionAuthorizationActive(authorization, "issue:267", now), true);
  assert.equal(isTaskProductionDeployAuthorizationActive(authorization, "issue:267", now), true);
  assert.equal(isTaskProductionDeployAuthorizationActive(authorization, "issue:268", now), false);
});

test("explicit Production wording remains recognized, while ordinary progress does not authorize completion", () => {
  assert.equal(requestsProductionDeploy("この機能を完成させてProductionまでデプロイして"), true);
  assert.equal(requestsProductionDeploy("本番まで反映して完成させて"), true);
  assert.equal(requestsProductionDeploy("完成させて"), true);
  assert.equal(requestsProductionDeploy("最後まで進めて"), true);
  assert.equal(requestsProductionDeploy("デプロイして"), false);
  assert.equal(requestsProductionDeploy("Productionの状態を確認して"), false);
  assert.equal(requestsTaskCompletion("Issue #243の状態を確認して進めて"), false);
  assert.equal(createTaskCompletionAuthorization("Issue #243の状態を確認して進めて"), undefined);
});

test("task authorization cannot be reused across scope or after expiry", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const authorization = createTaskCompletionAuthorization(
    "#243を完成させて",
    { now, ttlHours: 1, idFactory: () => "fixed" },
  );

  assert.equal(isTaskCompletionAuthorizationActive(authorization, "issue:244", now), false);
  assert.equal(isTaskProductionDeployAuthorizationActive(authorization, "issue:244", now), false);
  assert.equal(
    isTaskCompletionAuthorizationActive(authorization, "issue:243", new Date("2026-09-08T01:00:01.000Z")),
    false,
  );
  assert.equal(
    isTaskProductionDeployAuthorizationActive(authorization, "issue:243", new Date("2026-09-08T01:00:01.000Z")),
    false,
  );
});
