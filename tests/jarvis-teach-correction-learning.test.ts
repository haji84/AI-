import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { VerifiedWorkLearningEngine } from "../src/gai/work-learning.ts";
import {
  TeachingCorrectionLearningEngine,
  TeachingCorrectionLedger,
} from "../src/jarvis/teaching-correction-learning.ts";
import {
  TeachingStore,
  replayTeaching,
  type DeviceProfile,
  type Observation,
  type TeachingAdapter,
  type TeachingStep,
} from "../src/jarvis/teaching.ts";

function sig(value: number): string {
  return value.toString(16).padStart(64, "0");
}

const device: DeviceProfile = {
  deviceId: "teach-correction-device",
  platform: "windows",
  model: "test-model",
  osVersion: "1",
  app: "example.app",
  appVersion: "1",
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-teach-correction-"));
  const teachingPath = join(root, "teaching.json");
  const correctionPath = join(root, "teaching-corrections.json");
  const memoryPath = join(root, "memory.json");
  const skillPath = join(root, "skills.json");
  return {
    root,
    teachingPath,
    correctionPath,
    memoryPath,
    skillPath,
    store: new TeachingStore(teachingPath),
    corrections: new TeachingCorrectionLedger(correctionPath),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

function keyStep(before: string, after: string, key: "BACK" | "HOME"): TeachingStep {
  return {
    action: { kind: "key", key },
    before,
    after,
    gate: false,
  };
}

function observation(signature: string): Observation {
  return { signature, profile: device, targets: [], protectedScreen: false };
}

async function prepareVerifiedCorrectedFixture() {
  const f = fixture();
  const source = f.store.start({
    goal: "open verified work screen",
    scope: "device",
    profile: device,
    sessionId: "authorized-recording-session",
  });

  const mistake = keyStep(sig(1), sig(9), "BACK");
  f.store.append(source.id, mistake);
  assert.equal(f.corrections.list().length, 0, "ordinary BACK must never infer a mistake");

  const correction = f.corrections.begin(f.store.get(source.id), 0, sig(9));
  assert.equal(correction.status, "RETURN_REQUIRED");
  assert.throws(
    () => f.corrections.assertLearningAllowed(source.id),
    /Learning is paused/,
  );
  assert.throws(
    () => f.corrections.confirmReturn(correction.id, f.store.get(source.id), sig(7)),
    /pre-error state/,
  );

  f.corrections.confirmReturn(correction.id, f.store.get(source.id), sig(1));
  const corrected = keyStep(sig(1), sig(2), "HOME");
  f.store.append(source.id, corrected);
  f.corrections.complete(correction.id, f.store.get(source.id), 1);
  f.corrections.assertLearningAllowed(source.id);
  f.store.finish(source.id, "verified work screen is visible", sig(2));

  const derived = f.corrections.deriveCorrectedVariant(f.store, source.id);
  assert.equal(derived.status, "DRAFT");
  assert.equal(derived.steps.length, 1);
  assert.deepEqual(derived.steps[0].action, { kind: "key", key: "HOME" });
  assert.equal(f.corrections.deriveCorrectedVariant(f.store, source.id).id, derived.id, "derivation is idempotent");

  const observations = [sig(1), sig(1), sig(2), sig(2)];
  let executions = 0;
  const adapter: TeachingAdapter = {
    authorize() {},
    async observe() {
      const next = observations.shift();
      if (!next) throw Error("unexpected observation request");
      return observation(next);
    },
    async execute(action) {
      executions += 1;
      assert.deepEqual(action, { kind: "key", key: "HOME" });
    },
  };
  const run = await replayTeaching(f.store, derived.id, adapter, "verify");
  assert.equal(run.status, "PASSED");
  assert.equal(run.mode, "verify");
  assert.equal(executions, 1);
  assert.equal(f.store.get(derived.id).status, "VERIFIED");

  return { f, sourceId: source.id, derivedId: derived.id, runId: run.id, correctionId: correction.id };
}

test("explicit correction pauses learning, requires exact safe return, and derives a clean variant", async () => {
  const { f, sourceId, derivedId, correctionId } = await prepareVerifiedCorrectedFixture();
  try {
    const records = f.corrections.list();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, correctionId);
    assert.equal(records[0].sourceVariantId, sourceId);
    assert.equal(records[0].derivedVariantId, derivedId);
    assert.equal(records[0].status, "CORRECTED");
    assert.equal(records[0].mistakenStepIndex, 0);
    assert.equal(records[0].correctedStepIndex, 1);

    const serialized = readFileSync(f.correctionPath, "utf8");
    assert(!serialized.includes("authorized-recording-session"));
    assert(!serialized.includes("password"));
    assert(!serialized.includes("screenshot"));
  } finally {
    f.clean();
  }
});

test("only an independently verified corrected replay can create a durable inactive Skill candidate", async () => {
  const { f, sourceId, derivedId, runId, correctionId } = await prepareVerifiedCorrectedFixture();
  try {
    const memory = new PersistentMemoryStore(f.memoryPath);
    const skills = new PersistentSkillLibrary(f.skillPath);
    const learning = new TeachingCorrectionLearningEngine(new VerifiedWorkLearningEngine(memory, skills));

    await assert.rejects(
      learning.learnFromVerifiedDerivedReplay(f.store, f.corrections, sourceId, runId),
      /explicit correction provenance/,
    );

    const result = await learning.learnFromVerifiedDerivedReplay(f.store, f.corrections, derivedId, runId);
    assert.equal(result.status, "CANDIDATE_CREATED");
    assert(result.skill);
    assert.equal(result.skill.status, "candidate");
    assert(result.skill.provenance.includes(`teaching-run:${runId}`));
    assert(result.skill.provenance.includes(`teaching-correction:${correctionId}`));
    assert.match(result.skill.procedure, new RegExp(`^teaching-variant:${derivedId}@sha256:[a-f0-9]{64}$`));
    assert(!result.skill.procedure.includes("BACK"));

    const beforeCertification = await skills.query("open verified work screen");
    assert.deepEqual(beforeCertification, [], "candidate Skills are never active execution context");

    const certified = await skills.certify(result.skill.id, ["independent-review:test-only"]);
    assert(certified);
    assert.equal(certified.status, "active");
    const reusable = await skills.query("open verified work screen");
    assert.equal(reusable.length, 1, "certified Skill can be reused by existing context selection");
  } finally {
    f.clean();
  }
});

test("correction provenance and verified learning remain durable and idempotent across restart", async () => {
  const { f, derivedId, runId } = await prepareVerifiedCorrectedFixture();
  try {
    const firstMemory = new PersistentMemoryStore(f.memoryPath);
    const firstSkills = new PersistentSkillLibrary(f.skillPath);
    const firstLearning = new TeachingCorrectionLearningEngine(new VerifiedWorkLearningEngine(firstMemory, firstSkills));
    const first = await firstLearning.learnFromVerifiedDerivedReplay(f.store, f.corrections, derivedId, runId);
    assert.equal(first.status, "CANDIDATE_CREATED");

    const restartedStore = new TeachingStore(f.teachingPath);
    const restartedCorrections = new TeachingCorrectionLedger(f.correctionPath);
    const restartedMemory = new PersistentMemoryStore(f.memoryPath);
    const restartedSkills = new PersistentSkillLibrary(f.skillPath);
    const restartedLearning = new TeachingCorrectionLearningEngine(
      new VerifiedWorkLearningEngine(restartedMemory, restartedSkills),
    );
    const second = await restartedLearning.learnFromVerifiedDerivedReplay(
      restartedStore,
      restartedCorrections,
      derivedId,
      runId,
    );
    assert.equal(second.status, "IDEMPOTENT_REPLAY");
    assert.equal(second.skill?.id, first.skill?.id);
    assert.equal(restartedCorrections.provenanceForDerived(derivedId)?.sourceVariantId.length > 0, true);
  } finally {
    f.clean();
  }
});

test("correction storage fails closed on tampering instead of manufacturing learning evidence", async () => {
  const { f } = await prepareVerifiedCorrectedFixture();
  try {
    const raw = JSON.parse(readFileSync(f.correctionPath, "utf8")) as {
      corrections: Array<{ status: string }>;
    };
    raw.corrections[0].status = "CERTIFIED_BY_MAGIC";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(f.correctionPath, JSON.stringify(raw), "utf8");
    assert.throws(() => new TeachingCorrectionLedger(f.correctionPath), /Invalid correction status/);
  } finally {
    f.clean();
  }
});
