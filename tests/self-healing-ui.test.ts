import assert from "node:assert/strict";
import test from "node:test";
import { SelfHealingUiRuntime, type UiActionRequest, type UiCandidate, type UiDriver, type UiLookupStrategy } from "../src/gai/self-healing-ui.ts";

const request: UiActionRequest = { taskId: "t1", action: "click", target: { role: "button", name: "保存", semanticPurpose: "save document" } };

function driver(foundAt: UiLookupStrategy, candidate?: Partial<UiCandidate>): UiDriver {
  return {
    async find(_request, strategy) {
      if (strategy !== foundAt) return [];
      return [{ id: "save", strategy, role: "button", name: "保存する", semanticPurpose: "save document", confidence: 0.9, ...candidate }];
    },
    async execute() { return { ok: true }; },
  };
}

test("recovers a changed selector through semantic lookup and verifies outcome", async () => {
  const runtime = new SelfHealingUiRuntime(driver("semantic"), { async verify() { return { ok: true, detail: "saved" }; } });
  const result = await runtime.run(request);
  assert.equal(result.ok, true);
  assert.equal(result.candidate?.strategy, "semantic");
  assert.equal(result.evidence.at(-1)?.outcome, "verified");
});

test("uses vision only after earlier semantic paths fail", async () => {
  const runtime = new SelfHealingUiRuntime(driver("vision"), { async verify() { return { ok: true }; } });
  const result = await runtime.run(request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence.slice(0, 3).map((e) => e.strategy), ["exact", "accessibility", "semantic"]);
  assert.equal(result.candidate?.strategy, "vision");
});

test("rejects a visually plausible candidate with the wrong semantic purpose", async () => {
  const runtime = new SelfHealingUiRuntime(driver("vision", { semanticPurpose: "delete document", confidence: 0.99 }), { async verify() { return { ok: true }; } });
  const result = await runtime.run(request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "attempt-budget-exhausted");
});

test("does not report success when outcome verifier rejects the action", async () => {
  const runtime = new SelfHealingUiRuntime(driver("exact"), { async verify() { return { ok: false, detail: "save marker absent" }; } });
  const result = await runtime.run(request);
  assert.equal(result.ok, false);
  assert.equal(result.evidence.some((e) => e.outcome === "verification-failed"), true);
});

test("enforces bounded attempt budget", async () => {
  const runtime = new SelfHealingUiRuntime({ async find() { return []; }, async execute() { return { ok: false }; } }, { async verify() { return { ok: false }; } }, 2);
  const result = await runtime.run(request);
  assert.equal(result.reason, "attempt-budget-exhausted");
  assert.equal(result.evidence.length, 2);
});

test("preserves Human Gate before any UI lookup or execution", async () => {
  let touched = false;
  const runtime = new SelfHealingUiRuntime({ async find() { touched = true; return []; }, async execute() { touched = true; return { ok: true }; } }, { async verify() { return { ok: true }; } });
  const result = await runtime.run({ ...request, humanGateRequired: true, humanGateApproved: false });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "human-gate");
  assert.equal(touched, false);
});
