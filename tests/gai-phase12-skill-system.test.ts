import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { GaiSkillContextSource } from "../src/orchestrator/gai-skill-context.ts";

async function library() {
  const dir = await mkdtemp(join(tmpdir(), "gai-skill-"));
  return { store: new PersistentSkillLibrary(join(dir, "skills.json")), path: join(dir, "skills.json") };
}

const verified = {
  id: "local-research",
  name: "Local research",
  description: "research documents with a local model",
  procedure: '{"capability":"research.local","input":{"mode":"bounded"}}',
  applicability: ["research", "documents"],
  evidence: ["verifier:pass", "artifact:result.json"],
  verificationPassed: true,
  success: true,
  confidence: 0.9,
  source: "task:42",
  constraints: { capabilities: ["research.local"], connectivity: "offline-capable" as const, maxRisk: "medium" as const },
};

test("only verified successful evidence creates a candidate and certification activates it", async () => {
  const { store } = await library();
  assert.equal(await store.createCandidate({ ...verified, verificationPassed: false }), null);
  assert.equal(await store.createCandidate({ ...verified, success: false }), null);
  assert.equal(await store.createCandidate({ ...verified, evidence: [] }), null);
  const candidate = await store.createCandidate(verified);
  assert.equal(candidate?.status, "candidate");
  assert.equal((await store.query("research documents")).length, 0);
  assert.equal(await store.certify(verified.id, []), null);
  const active = await store.certify(verified.id, ["contract-eval:pass", "regression:pass"]);
  assert.equal(active?.status, "active");
  assert.deepEqual(active?.certificationEvidence, ["contract-eval:pass", "regression:pass"]);
});

test("skill discovery respects capability, connectivity and risk constraints", async () => {
  const { store } = await library();
  await store.createCandidate({ ...verified, constraints: { capabilities: ["research.local"], connectivity: "online-required", maxRisk: "medium" } });
  await store.certify(verified.id, ["eval:pass"]);
  assert.equal((await store.query("research documents", 5, { capabilities: ["research.local"], online: false, risk: "low" })).length, 0);
  assert.equal((await store.query("research documents", 5, { capabilities: ["research.local"], online: true, risk: "high" })).length, 0);
  assert.equal((await store.query("research documents", 5, { capabilities: ["research.local"], online: true, risk: "medium" })).length, 1);
});

test("offline-capable certified skill is planner-visible and bounded", async () => {
  const { store } = await library();
  for (let index = 0; index < 3; index += 1) {
    const id = `skill-${index}`;
    await store.createCandidate({ ...verified, id, name: `Research ${index}` });
    await store.certify(id, [`eval:${index}`]);
  }
  const source = new GaiSkillContextSource(store, async () => ({ capabilities: ["research.local"], online: false, risk: "low" }), 2);
  const context = await source.collect({ goal: { title: "research documents", description: "use local research", successCriteria: ["done"], constraints: [] } });
  assert.equal(context.length, 2);
  assert.ok(context.every((item) => item.source === "gai-skills"));
});

test("repeated failed outcomes demote an active skill", async () => {
  const { store } = await library();
  await store.createCandidate({ ...verified, confidence: 0.5 });
  await store.certify(verified.id, ["eval:pass"]);
  await store.recordOutcome(verified.id, false);
  await store.recordOutcome(verified.id, false);
  const result = await store.recordOutcome(verified.id, false);
  assert.equal(result?.status, "demoted");
  assert.equal((await store.query("research documents")).length, 0);
});

test("candidate revisions retain version lineage and persistence", async () => {
  const { store, path } = await library();
  const first = await store.createCandidate(verified);
  await store.certify(verified.id, ["eval:v1"]);
  const second = await store.createCandidate({ ...verified, procedure: '{"capability":"research.local","input":{"mode":"improved"}}', source: "task:43" });
  assert.equal(first?.version, 1);
  assert.equal(second?.version, 2);
  assert.equal(second?.parentVersion, 1);
  const restarted = new PersistentSkillLibrary(path);
  const loaded = await restarted.get(verified.id);
  assert.equal(loaded?.version, 2);
  assert.ok(loaded?.provenance.includes("task:43"));
  const raw = JSON.parse(await readFile(path, "utf8")) as { version: number };
  assert.equal(raw.version, 2);
});
