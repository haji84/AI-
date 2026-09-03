import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  commandTargetIssueNumber,
  invalidatePersistedCommandIfTargetClosed,
  resolvePersistentCommandEnvelope,
} from "../src/orchestrator/persistent-command-handoff.ts";

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
    /not valid JSON/,
  );
  assert.equal(resolvePersistentCommandEnvelope({ stateDir: dir }), first);
});

test("fresh state with no command fails visibly", () => {
  assert.throws(
    () => resolvePersistentCommandEnvelope({ stateDir: stateDir() }),
    /command handoff is required and no persisted command is available/,
  );
});

test("extracts an explicit Issue target from a persisted command", () => {
  assert.equal(commandTargetIssueNumber(command("Run Issue #125 live smoke test")), 125);
  assert.equal(commandTargetIssueNumber(command("Inspect repository status")), undefined);
});

test("keeps a persisted command when its target Issue is still open", () => {
  const dir = stateDir();
  const envelope = command("Run Issue #125 live smoke test");
  resolvePersistentCommandEnvelope({ explicitJson: envelope, stateDir: dir });

  assert.equal(invalidatePersistedCommandIfTargetClosed({
    envelopeJson: envelope,
    stateDir: dir,
    openIssueNumbers: [125, 138],
  }), undefined);
  assert.equal(existsSync(join(dir, "last-command.json")), true);
});

test("invalidates a persisted command when its target Issue is no longer open", () => {
  const dir = stateDir();
  const envelope = command("Run Issue #125 live smoke test");
  resolvePersistentCommandEnvelope({ explicitJson: envelope, stateDir: dir });

  assert.equal(invalidatePersistedCommandIfTargetClosed({
    envelopeJson: envelope,
    stateDir: dir,
    openIssueNumbers: [138],
  }), 125);
  assert.equal(existsSync(join(dir, "last-command.json")), false);
  assert.throws(
    () => resolvePersistentCommandEnvelope({ stateDir: dir }),
    /command handoff is required and no persisted command is available/,
  );
});

test("commands without an explicit Issue target are not invalidated", () => {
  const dir = stateDir();
  const envelope = command("Inspect repository status");
  resolvePersistentCommandEnvelope({ explicitJson: envelope, stateDir: dir });

  assert.equal(invalidatePersistedCommandIfTargetClosed({
    envelopeJson: envelope,
    stateDir: dir,
    openIssueNumbers: [],
  }), undefined);
  assert.equal(existsSync(join(dir, "last-command.json")), true);
});
