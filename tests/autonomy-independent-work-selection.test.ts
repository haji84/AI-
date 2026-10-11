import assert from "node:assert/strict";
import test from "node:test";
import { selectIndependentWorkItem, type ChildWorkItem } from "../src/orchestrator/work-state.ts";

function item(id: string, status: ChildWorkItem["status"], scope: string): ChildWorkItem {
  return {
    id, status, objective: id, affectedScope: [scope],
    definitionOfDone: [{ id: `${id}-verified`, description: "Verifier confirms outcome" }], executionApproach: "bounded", verificationMethod: "verifier",
  };
}

test("approval-gated work remains excluded while an independent ready item is selected", () => {
  const items = [item("needs-approval", "NOT_STARTED", "protected"),
    item("safe", "NOT_STARTED", "docs"), item("done", "COMPLETED", "other")];
  const selected = selectIndependentWorkItem(items, ["needs-approval"], ["protected"]);
  assert.equal(selected?.id, "safe");
  assert.equal(items[0].status, "NOT_STARTED");
});

test("no eligible independent item returns null without bypassing the gate", () => {
  assert.equal(selectIndependentWorkItem([
    item("gated", "NOT_STARTED", "protected"),
    item("overlap", "NOT_STARTED", "protected"),
    item("blocked", "BLOCKED", "docs"),
  ], ["gated"], ["protected"]), null);
});

test("candidate selection does not authorize blocked work or a completed task", () => {
  const items = [
    item("waiting", "BLOCKED", "docs"),
    item("finished", "COMPLETED", "other"),
  ];
  assert.equal(selectIndependentWorkItem(items, ["waiting"], ["docs"]), null);
});
