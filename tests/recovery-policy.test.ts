import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecovery } from "../src/orchestrator/recovery-policy.ts";

test("transient failures retry the same operation before the per-signature limit", () => {
  const decision = evaluateRecovery({
    failureSignature: "network-timeout",
    failureClass: "transient",
    attemptsForSignature: 2,
    strategyPivots: 0,
    totalAttempts: 2,
  });

  assert.equal(decision.action, "retry_same");
  assert.equal(decision.blocked, false);
});

test("implementation failures repair within the current strategy before pivoting", () => {
  const decision = evaluateRecovery({
    failureSignature: "build-missing-import",
    failureClass: "implementation",
    attemptsForSignature: 2,
    strategyPivots: 0,
    totalAttempts: 2,
  });

  assert.equal(decision.action, "repair");
  assert.equal(decision.blocked, false);
});

test("three attempts of the same failure pivot instead of blocking immediately", () => {
  const decision = evaluateRecovery({
    failureSignature: "build-missing-import",
    failureClass: "implementation",
    attemptsForSignature: 3,
    strategyPivots: 0,
    totalAttempts: 3,
  });

  assert.equal(decision.action, "strategy_pivot");
  assert.equal(decision.nextStrategyPivot, 1);
  assert.equal(decision.blocked, false);
});

test("a second exhausted strategy can pivot once more", () => {
  const decision = evaluateRecovery({
    failureSignature: "packaging-runtime-error",
    failureClass: "implementation",
    attemptsForSignature: 3,
    strategyPivots: 1,
    totalAttempts: 6,
  });

  assert.equal(decision.action, "strategy_pivot");
  assert.equal(decision.nextStrategyPivot, 2);
  assert.equal(decision.blocked, false);
});

test("persistent failure after the pivot budget becomes BLOCKED with a human hint", () => {
  const decision = evaluateRecovery({
    failureSignature: "packaging-runtime-error",
    failureClass: "implementation",
    attemptsForSignature: 3,
    strategyPivots: 2,
    totalAttempts: 8,
  });

  assert.equal(decision.action, "blocked");
  assert.equal(decision.blocked, true);
  assert.ok(decision.humanInterventionHint);
});

test("explicit blockers stop immediately without burning retry budget", () => {
  const decision = evaluateRecovery({
    failureSignature: "local-runtime-required",
    failureClass: "environment",
    attemptsForSignature: 0,
    strategyPivots: 0,
    totalAttempts: 0,
    explicitBlocker: "A Windows workstation is required to verify the executable",
  });

  assert.equal(decision.action, "blocked");
  assert.match(decision.reason, /Explicit blocker/);
});

test("total recovery budget prevents an infinite repair loop", () => {
  const decision = evaluateRecovery({
    failureSignature: "changing-failure",
    failureClass: "unknown",
    attemptsForSignature: 1,
    strategyPivots: 1,
    totalAttempts: 9,
  });

  assert.equal(decision.action, "blocked");
  assert.match(decision.reason, /budget exhausted/);
});
