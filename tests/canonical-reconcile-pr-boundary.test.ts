import assert from "node:assert/strict";
import test from "node:test";

import {
  createSafePrProposalCapability,
  parseCanonicalReconciliationDirective,
} from "../src/orchestrator/safe-pr-capability.ts";
import type { ProposedAction } from "../src/orchestrator/goal-loop.ts";

test("canonical reconciliation directive is exact and allowlisted", () => {
  assert.deepEqual(
    parseCanonicalReconciliationDirective({
      path: "docs/.jarvis-reconcile/SEC-012",
      content: "",
    }),
    {
      requirementId: "SEC-012",
      script: "scripts/reconcile-issue-952-sec012.mjs",
      issueNumber: 952,
    },
  );

  assert.deepEqual(
    parseCanonicalReconciliationDirective({
      path: "docs/.jarvis-reconcile/SEC-013",
      content: "",
    }),
    {
      requirementId: "SEC-013",
      script: "scripts/reconcile-issue-960-sec013.mjs",
      issueNumber: 960,
    },
  );

  assert.deepEqual(
    parseCanonicalReconciliationDirective({
      path: "docs/.jarvis-reconcile/SEC-014",
      content: "",
    }),
    {
      requirementId: "SEC-014",
      script: "scripts/reconcile-issue-964-sec014.mjs",
      issueNumber: 964,
    },
  );

  assert.equal(
    parseCanonicalReconciliationDirective({ path: "docs/evidence/note.md", content: "safe" }),
    null,
  );
});

test("canonical reconciliation directive rejects arbitrary ids and payloads", () => {
  assert.throws(
    () => parseCanonicalReconciliationDirective({
      path: "docs/.jarvis-reconcile/SEC-999",
      content: "",
    }),
    /not allowlisted/,
  );
  assert.throws(
    () => parseCanonicalReconciliationDirective({
      path: "docs/.jarvis-reconcile/SEC-012",
      content: "run arbitrary command",
    }),
    /content must be empty/,
  );
});

test("canonical reconciliation cannot be mixed with ordinary proposal files", async () => {
  const capability = createSafePrProposalCapability({
    token: "fixture-token",
    repository: "haji84/AI-",
  });
  const action: ProposedAction = {
    id: "reconcile:mixed",
    description: "must fail closed",
    capability: "repository.propose_pr",
    risk: "low",
    input: {
      title: "invalid mixed proposal",
      files: [
        { path: "docs/.jarvis-reconcile/SEC-012", content: "" },
        { path: "docs/extra.md", content: "unexpected" },
      ],
    },
  };

  const result = await capability.execute(action);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "proposal_failed");
  assert.match(result.summary, /cannot be mixed/);
});
