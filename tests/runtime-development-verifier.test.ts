import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";

const verifier = createRuntimeDevelopmentVerifier();

test("runtime development verifier accepts bounded changed-file evidence", async () => {
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: {
      id: "a",
      description: "edit fixture",
      capability: "code.builder",
      risk: "low",
      input: { files: ["tests/fixture.txt"] },
    },
    result: {
      actionId: "a",
      ok: true,
      summary: "done",
      evidence: { remoteEvidence: { changedFiles: ["tests/fixture.txt"], diffCheckPassed: true } },
    },
    context: [],
  });
  assert.equal(result.ok, true);
});

test("runtime development verifier rejects out-of-scope changes", async () => {
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: {
      id: "a",
      description: "edit fixture",
      capability: "code.builder",
      risk: "low",
      input: { files: ["tests/fixture.txt"] },
    },
    result: {
      actionId: "a",
      ok: true,
      summary: "done",
      evidence: { remoteEvidence: { changedFiles: ["tests/fixture.txt", "src/other.ts"], diffCheckPassed: true } },
    },
    context: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.summary, /outside the approved scope/);
});

test("runtime development verifier rejects missing or failed deterministic diff evidence", async () => {
  for (const remoteEvidence of [
    { changedFiles: ["tests/fixture.txt"], diffCheckPassed: false, diffCheckOutput: "whitespace error" },
    { changedFiles: [], diffCheckPassed: true },
  ]) {
    const result = await verifier.verify({
      goal: { title: "g", successCriteria: [], constraints: [] },
      action: {
        id: "a",
        description: "edit fixture",
        capability: "code.builder",
        risk: "low",
        input: { files: ["tests/fixture.txt"] },
      },
      result: { actionId: "a", ok: true, summary: "done", evidence: { remoteEvidence } },
      context: [],
    });
    assert.equal(result.ok, false);
  }
});
