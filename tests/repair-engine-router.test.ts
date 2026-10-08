import assert from "node:assert/strict";
import test from "node:test";
import {
  REPAIR_ENGINE_ESCALATION_ORDER,
  executableRepairEngines,
  nextRepairEngine,
} from "../src/orchestrator/repair-engine-router.ts";

test("repair escalation order keeps GORIQ first and Codex immediately before Human Gate", () => {
  assert.deepEqual(
    REPAIR_ENGINE_ESCALATION_ORDER.map((stage) => stage.id),
    [
      "goriq-deterministic",
      "goriq-learned",
      "goriq-local-code",
      "goriq-local-capability",
      "chat",
      "work",
      "free-external",
      "codex",
      "human-gate",
    ],
  );
  assert.deepEqual(
    REPAIR_ENGINE_ESCALATION_ORDER.map((stage) => stage.priority),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});

test("unavailable engines are skipped without changing priority", () => {
  const available = executableRepairEngines({
    "goriq-deterministic": true,
    chat: true,
    codex: true,
  });
  assert.deepEqual(available.map((stage) => stage.id), [
    "goriq-deterministic",
    "chat",
    "codex",
  ]);
});

test("next engine advances through attempts and terminates at Human Gate", () => {
  const availability = {
    "goriq-deterministic": true,
    chat: true,
    work: true,
    "free-external": true,
    codex: true,
  };
  assert.equal(nextRepairEngine(availability).id, "goriq-deterministic");
  assert.equal(nextRepairEngine(availability, ["goriq-deterministic"]).id, "chat");
  assert.equal(nextRepairEngine(availability, ["goriq-deterministic", "chat"]).id, "work");
  assert.equal(nextRepairEngine(availability, ["goriq-deterministic", "chat", "work"]).id, "free-external");
  assert.equal(nextRepairEngine(availability, ["goriq-deterministic", "chat", "work", "free-external"]).id, "codex");
  assert.equal(nextRepairEngine(availability, ["goriq-deterministic", "chat", "work", "free-external", "codex"]).id, "human-gate");
});
