import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskCompletionAuthorization,
  isTaskCompletionAuthorizationActive,
  requestsTaskCompletion,
} from "../src/orchestrator/task-authorization.ts";

test("explicit completion language creates an owner task authorization", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const authorization = createTaskCompletionAuthorization(
    "Issue #243を最後まで進めて",
    { now, idFactory: () => "fixed" },
  );

  assert.equal(requestsTaskCompletion("Issue #243を最後まで進めて"), true);
  assert.equal(authorization?.scopeId, "issue:243");
  assert.equal(authorization?.allowLowMediumMainMerge, true);
  assert.equal(authorization?.issuedBy, "owner");
  assert.equal(isTaskCompletionAuthorizationActive(authorization, "issue:243", now), true);
});

test("ordinary progress language does not silently pre-authorize main merge", () => {
  assert.equal(requestsTaskCompletion("Issue #243の状態を確認して進めて"), false);
  assert.equal(createTaskCompletionAuthorization("Issue #243の状態を確認して進めて"), undefined);
});

test("task authorization cannot be reused across scope or after expiry", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const authorization = createTaskCompletionAuthorization(
    "#243は任せる",
    { now, ttlHours: 1, idFactory: () => "fixed" },
  );

  assert.equal(isTaskCompletionAuthorizationActive(authorization, "issue:244", now), false);
  assert.equal(
    isTaskCompletionAuthorizationActive(authorization, "issue:243", new Date("2026-09-08T01:00:01.000Z")),
    false,
  );
});
