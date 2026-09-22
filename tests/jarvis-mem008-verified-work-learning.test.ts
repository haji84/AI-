import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import {
  VerifiedWorkLearningEngine,
  type WorkLearningTrace,
} from "../src/gai/work-learning.ts";

async function stores() {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-mem008-"));
  return {
    memoryPath: join(dir, "memory.json"),
    skillsPath: join(dir, "skills.json"),
  };
}

const recoveredSuccess = (): WorkLearningTrace => ({
  goalId: "goal-42",
  goalSummary: "Produce the verified local report",
  capability: "document.local",
  applicability: ["report", "document"],
  plan: ["load verified facts", "render document", "verify persisted artifact"],
  attempts: [
    {
      id: "attempt-1",
      strategyId: "render-v1",
      procedure: '{"capability":"document.local","template":"v1"}',
      resultOk: true,
      verifierPassed: false,
      evidenceRefs: ["verifier:fail:missing-section"],
      recovery: {
        action: "strategy_pivot",
        reason: "render the required section explicitly",
      },
    },
    {
      id: "attempt-2",
      strategyId: "render-v2",
      procedure: '{"capability":"document.local","template":"v2"}',
      resultOk: true,
      verifierPassed: true,
      evidenceRefs: ["verifier:pass", "artifact:sha256:abc123"],
    },
  ],
  outcome: "COMPLETED",
  completedAt: "2026-09-22T09:00:00.000Z",
  constraints: {
    capabilities: ["document.local"],
    connectivity: "offline-capable",
    maxRisk: "medium",
  },
});

test("MEM-008 records recovery history and creates only a non-active candidate from verified completion", async () => {
  const paths = await stores();
  const memory = new PersistentMemoryStore(paths.memoryPath);
  const skills = new PersistentSkillLibrary(paths.skillsPath);
  const engine = new VerifiedWorkLearningEngine(memory, skills);

  const result = await engine.learn(recoveredSuccess());

  assert.equal(result.status, "CANDIDATE_CREATED");
  assert.equal(result.skill?.status, "candidate");
  assert.equal(result.skill?.version, 1);
  assert.ok(result.skill?.provenance.includes(`trace:${result.traceDigest}`));
  assert.ok(result.skill?.provenance.includes("verifier:pass"));
  assert.equal((await skills.query("document report")).length, 0, "candidate must not gain execution authority before certification");

  const memories = await memory.query({ tags: ["verified-work"], limit: 10 });
  assert.equal(memories.length, 2);
  const episode = memories.find((record) => record.kind === "episodic");
  const procedure = memories.find((record) => record.kind === "procedural");
  assert.ok(episode);
  assert.ok(procedure);
  assert.match(episode.content, /strategy_pivot/);
  assert.match(episode.content, /verifier:fail:missing-section/);
  assert.equal(procedure.content, '{"capability":"document.local","template":"v2"}');
});

test("MEM-008 rejects fake completion without final verifier PASS and persists nothing reusable", async () => {
  const paths = await stores();
  const memory = new PersistentMemoryStore(paths.memoryPath);
  const skills = new PersistentSkillLibrary(paths.skillsPath);
  const engine = new VerifiedWorkLearningEngine(memory, skills);
  const trace = recoveredSuccess();
  trace.attempts = [{
    id: "attempt-unverified",
    strategyId: "render-v3",
    procedure: '{"capability":"document.local","template":"v3"}',
    resultOk: true,
    verifierPassed: false,
    evidenceRefs: ["verifier:fail:mismatch"],
  }];

  const result = await engine.learn(trace);

  assert.equal(result.status, "REJECTED_UNVERIFIED");
  assert.equal(result.episode, null);
  assert.equal(result.procedure, null);
  assert.equal(result.skill, null);
  assert.deepEqual(await memory.query(), []);
  assert.deepEqual(await skills.query("document report"), []);
});

test("MEM-008 retains evidence-backed failure as negative experience but never promotes it", async () => {
  const paths = await stores();
  const memory = new PersistentMemoryStore(paths.memoryPath);
  const skills = new PersistentSkillLibrary(paths.skillsPath);
  const engine = new VerifiedWorkLearningEngine(memory, skills);
  const trace = recoveredSuccess();
  trace.outcome = "FAILED";
  trace.attempts = [{
    id: "attempt-failed",
    strategyId: "render-broken",
    procedure: '{"capability":"document.local","template":"broken"}',
    resultOk: false,
    verifierPassed: false,
    evidenceRefs: ["runtime:failed:renderer"],
  }];

  const result = await engine.learn(trace);

  assert.equal(result.status, "NEGATIVE_EPISODE_RECORDED");
  assert.equal(result.procedure, null);
  assert.equal(result.skill, null);
  const negative = await memory.query({ tags: ["negative-experience"] });
  assert.equal(negative.length, 1);
  assert.match(negative[0].content, /render-broken/);
  assert.deepEqual(await skills.query("document report"), []);
});

test("MEM-008 replay is idempotent across restart and does not mint another skill version", async () => {
  const paths = await stores();
  const firstMemory = new PersistentMemoryStore(paths.memoryPath);
  const firstSkills = new PersistentSkillLibrary(paths.skillsPath);
  const first = await new VerifiedWorkLearningEngine(firstMemory, firstSkills).learn(recoveredSuccess());
  assert.equal(first.skill?.version, 1);

  const restartedMemory = new PersistentMemoryStore(paths.memoryPath);
  const restartedSkills = new PersistentSkillLibrary(paths.skillsPath);
  const second = await new VerifiedWorkLearningEngine(restartedMemory, restartedSkills).learn(recoveredSuccess());

  assert.equal(second.status, "IDEMPOTENT_REPLAY");
  assert.equal(second.skill?.version, 1);
  assert.equal((await restartedMemory.query({ tags: ["verified-work"], limit: 10 })).length, 2);
});

test("MEM-008 fails closed before persistence when a trace contains credential-like material", async () => {
  const paths = await stores();
  const memory = new PersistentMemoryStore(paths.memoryPath);
  const skills = new PersistentSkillLibrary(paths.skillsPath);
  const engine = new VerifiedWorkLearningEngine(memory, skills);
  const trace = recoveredSuccess();
  trace.attempts[1] = {
    ...trace.attempts[1],
    procedure: "curl -H 'Authorization: Bearer abcdefghijklmnop' https://example.test",
  };

  await assert.rejects(() => engine.learn(trace), /credential-like material/);
  assert.deepEqual(await memory.query(), []);
  assert.deepEqual(await skills.query("document report"), []);
});
