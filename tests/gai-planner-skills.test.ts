import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { PersistentWorldModel } from "../src/gai/world-model.ts";
import { GaiInformedPlanner } from "../src/orchestrator/gai-informed-planner.ts";

async function withRuntime(run: (input: {
  memory: PersistentMemoryStore;
  skills: PersistentSkillLibrary;
  world: PersistentWorldModel;
  dir: string;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-g3-"));
  const memory = new PersistentMemoryStore(join(dir, "memory.json"));
  const skills = new PersistentSkillLibrary(join(dir, "skills.json"));
  const world = new PersistentWorldModel(join(dir, "world.json"), memory);
  try {
    await run({ memory, skills, world, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("persists and retrieves transferable skills", async () => {
  await withRuntime(async ({ skills, dir }) => {
    await skills.upsert({
      id: "skill:test-first",
      name: "test before merge",
      description: "run regression tests before merging code",
      procedure: "run regression tests before merge",
      provenance: ["ci:verified"],
      applicability: ["code", "merge", "regression"],
      confidence: 0.9,
      successes: 3,
      failures: 0,
      status: "active",
    });
    assert.equal((await skills.query("merge code regression"))[0]?.id, "skill:test-first");
    const restarted = new PersistentSkillLibrary(join(dir, "skills.json"));
    assert.equal((await restarted.get("skill:test-first"))?.provenance[0], "ci:verified");
  });
});

test("demotes repeatedly failing skills", async () => {
  await withRuntime(async ({ skills }) => {
    await skills.upsert({
      id: "skill:weak",
      name: "weak approach",
      description: "weak approach for deployment",
      procedure: "weak approach",
      provenance: ["experiment"],
      applicability: ["deployment"],
      confidence: 0.5,
      successes: 0,
      failures: 0,
      status: "active",
    });
    await skills.recordOutcome("skill:weak", false);
    await skills.recordOutcome("skill:weak", false);
    const final = await skills.recordOutcome("skill:weak", false);
    assert.equal(final?.status, "demoted");
    assert.equal((await skills.query("deployment")).length, 0);
  });
});

test("planner uses memory, world evidence and a stronger matching skill", async () => {
  await withRuntime(async ({ memory, skills, world }) => {
    await memory.upsert({
      id: "mem:1",
      kind: "semantic",
      content: "regression tests reduce merge risk",
      source: "ci",
      confidence: 0.9,
      tags: ["merge", "regression"],
    });
    await skills.upsert({
      id: "skill:test-first",
      name: "test before merge",
      description: "regression merge safety",
      procedure: "run regression tests before merge",
      provenance: ["ci"],
      applicability: ["merge", "regression"],
      confidence: 0.95,
      successes: 4,
      failures: 0,
      status: "active",
    });
    for (let index = 0; index < 5; index += 1) {
      await world.record({
        id: `event:${index}`,
        context: "merge regression change",
        prediction: { action: "run regression tests before merge", expectedOutcome: "safe merge", confidence: 0.8 },
        observation: { actualOutcome: "safe merge", success: true, evidence: ["ci passed"] },
      });
    }

    const planner = new GaiInformedPlanner({ memory, world, skills });
    const goal = { title: "merge regression change", successCriteria: ["safe merge"], constraints: [] };
    const intent = await planner.inferIntent({ goal, context: [] });
    const action = await planner.proposeNextAction({ goal, intent, context: [{ source: "state.next_action", summary: "inspect merge change" }] });

    assert.equal(action?.id, "gai-skill:skill:test-first");
    assert.equal(action?.description, "run regression tests before merge");
    const metadata = (action as typeof action & { metadata?: { gaiEvidence?: { memories?: string[]; skills?: unknown[] }; priorWorldEvents?: number } })?.metadata;
    assert.ok((metadata?.gaiEvidence?.memories?.length ?? 0) > 0);
    assert.ok((metadata?.gaiEvidence?.skills?.length ?? 0) > 0);
    assert.ok((metadata?.priorWorldEvents ?? 0) > 0);
  });
});
