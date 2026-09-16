import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import type { LoopState, StateStore, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";
import {
  VerifiedSkillWriteBackStore,
  verifiedSkillCandidateFromWriteBack,
  type ReusableSkillProposal,
} from "../src/orchestrator/verified-skill-writeback.ts";

class MemoryStateStore implements StateStore {
  records: WriteBackRecord[] = [];
  async getState(): Promise<LoopState> {
    return { completed: [], blockers: [], nextAction: null };
  }
  async writeBack(record: WriteBackRecord): Promise<void> {
    this.records.push(record);
  }
}

const goal = {
  title: "Extract a verified reusable procedure",
  successCriteria: ["verified reusable procedure captured"],
  constraints: ["never learn from unverified self-report"],
};

const proposal: ReusableSkillProposal = {
  id: "verified-doc-check",
  name: "Verified document check",
  description: "Check a bounded document and record verifier evidence",
  procedure: '{"capability":"document.check","input":{"bounded":true}}',
  applicability: ["document", "verification"],
  confidence: 0.85,
  evidenceRefs: ["verifier:cycle-42", "artifact:report.json", "verifier:cycle-42"],
  source: "goal-loop:cycle-42",
  constraints: {
    capabilities: ["document.check"],
    connectivity: "either",
    maxRisk: "medium",
  },
};

function record(overrides: Partial<WriteBackRecord> = {}): WriteBackRecord {
  return {
    goal,
    intent: { summary: "continue", confidence: 1, evidence: [] },
    action: {
      id: "a1",
      description: "check document",
      capability: "document.check",
      risk: "low",
    },
    result: {
      actionId: "a1",
      ok: true,
      summary: "document checked",
      reusableSkill: proposal,
    },
    verification: {
      ok: true,
      summary: "independent verifier accepted result",
      evidence: { privateDetail: "not copied into skill provenance" },
    },
    stopReason: "continue",
    nextAction: null,
    ...overrides,
  } as WriteBackRecord;
}

async function skillLibrary(): Promise<PersistentSkillLibrary> {
  const dir = await mkdtemp(join(tmpdir(), "p7-verified-skill-"));
  return new PersistentSkillLibrary(join(dir, "skills.json"));
}

test("verified successful cycle yields a bounded candidate with explicit evidence refs", () => {
  const candidate = verifiedSkillCandidateFromWriteBack(record());
  assert.ok(candidate);
  assert.equal(candidate.verificationPassed, true);
  assert.equal(candidate.success, true);
  assert.deepEqual(candidate.evidence, ["verifier:cycle-42", "artifact:report.json"]);
  assert.equal(candidate.procedure, proposal.procedure);
  assert.deepEqual(candidate.constraints, proposal.constraints);
  assert.equal(JSON.stringify(candidate).includes("privateDetail"), false);
});

test("failed result, failed verifier, missing verification, or missing evidence fail closed", () => {
  assert.equal(verifiedSkillCandidateFromWriteBack(record({
    result: { actionId: "a1", ok: false, summary: "failed", reusableSkill: proposal } as never,
  })), null);
  assert.equal(verifiedSkillCandidateFromWriteBack(record({
    verification: { ok: false, summary: "rejected", evidence: "verifier:reject" },
  })), null);
  assert.equal(verifiedSkillCandidateFromWriteBack(record({ verification: null })), null);
  assert.equal(verifiedSkillCandidateFromWriteBack(record({
    result: {
      actionId: "a1",
      ok: true,
      summary: "done",
      reusableSkill: { ...proposal, evidenceRefs: [] },
    } as never,
  })), null);
});

test("approval-required cycle with no executed verified result cannot create a candidate", () => {
  assert.equal(verifiedSkillCandidateFromWriteBack(record({
    result: null,
    verification: null,
    stopReason: "approval_required",
  })), null);
});

test("write-back creates only a candidate; independent certification is still required for selection", async () => {
  const inner = new MemoryStateStore();
  const skills = await skillLibrary();
  const store = new VerifiedSkillWriteBackStore(inner, skills);

  await store.writeBack(record());

  assert.equal(inner.records.length, 1);
  const candidate = await skills.get(proposal.id);
  assert.equal(candidate?.status, "candidate");
  assert.equal((await skills.query("document verification")).length, 0);

  const active = await skills.certify(proposal.id, ["independent-contract-eval:pass"]);
  assert.equal(active?.status, "active");
  assert.equal((await skills.query("document verification")).length, 1);
});

test("unverified proposals are ignored while durable Goal Loop write-back still occurs", async () => {
  const inner = new MemoryStateStore();
  const skills = await skillLibrary();
  const store = new VerifiedSkillWriteBackStore(inner, skills);

  await store.writeBack(record({
    verification: { ok: false, summary: "verifier rejected", evidence: "reject" },
  }));

  assert.equal(inner.records.length, 1);
  assert.equal(await skills.get(proposal.id), null);
});
