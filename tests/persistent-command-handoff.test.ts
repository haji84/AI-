import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePersistentCommandEnvelope } from "../src/orchestrator/persistent-command-handoff.ts";

function command(command: string): string {
  return JSON.stringify({
    source: "chat",
    command,
    plan: { kind: "inspect", description: `Inspect ${command}` },
  });
}

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "autonomy-command-"));
}

test("persists an explicit valid command and reuses it when the next input is blank", () => {
  const dir = stateDir();
  const first = command("Issue #125 smoke test");

  assert.equal(resolvePersistentCommandEnvelope({ explicitJson: first, stateDir: dir }), first);
  assert.equal(resolvePersistentCommandEnvelope({ explicitJson: "", stateDir: dir }), first);
  assert.equal(readFileSync(join(dir, "last-command.json"), "utf-8").trim(), first);
});

test("a new explicit command replaces the persisted command", () => {
  const dir = stateDir();
  const first = command("first task");
  const second = command("second task");

  resolvePersistentCommandEnvelope({ explicitJson: first, stateDir: dir });
  assert.equal(resolvePersistentCommandEnvelope({ explicitJson: second, stateDir: dir }), second);
  assert.equal(resolvePersistentCommandEnvelope({ stateDir: dir }), second);
});

test("invalid explicit input does not replace the last valid persisted command", () => {
  const dir = stateDir();
  const first = command("safe task");

  resolvePersistentCommandEnvelope({ explicitJson: first, stateDir: dir });
  assert.throws(
    () => resolvePersistentCommandEnvelope({ explicitJson: "not-json", stateDir: dir }),
    /Unexpected token|JSON/,
  );
  assert.equal(resolvePersistentCommandEnvelope({ stateDir: dir }), first);
});

test("fresh state with no command fails visibly", () => {
  assert.throws(
    () => resolvePersistentCommandEnvelope({ stateDir: stateDir() }),
    /command handoff is required and no persisted command is available/,
  );
});
