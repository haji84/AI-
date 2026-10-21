import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OllamaPrimaryBrainAdapter } from "../src/gai/primary-brain.ts";
import type { PrimaryBrainContext } from "../src/gai/primary-brain.ts";
import { ResourceWaitError, withDevelopmentResourceAdmission } from "../src/gai/development-resource-admission.ts";

const context: PrimaryBrainContext = { goal: { title: "Inspect output", successCriteria: ["Output verified"], constraints: [] }, currentState: "ready",
  candidates: [], memories: [], world: [], previousAttempts: [], environment: "fixture", connectivity: "offline", budget: { remainingActions: 1 }, constraints: [] };

test("PrimaryBrain pressure wait propagates before any local-model transport call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brain-admission-"));
  let calls = 0;
  try {
    const adapter = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "fixture", fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ response: JSON.stringify({ candidateId: null, plan: [], assessment: "observed", hypotheses: [], expectedOutcome: "checked", confidence: 0.5, requiredEvidence: [], recoveryOptions: [], escalation: "none" }) }));
    }, admit: (work, options) => withDevelopmentResourceAdmission(work, { ...options, platform: "win32", leasePath: join(directory, "lane.lock"),
      probe: async () => ({ checkedAt: new Date().toISOString(), resources: { cpuLoadPercent: 10, memoryAvailableMb: 10000, diskAvailableMb: 20000, committedMemoryMb: 99999, commitLimitMb: 100000 } }) }) });
    await assert.rejects(adapter.plan(context), ResourceWaitError);
    assert.equal(calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
