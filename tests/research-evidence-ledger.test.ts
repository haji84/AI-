import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchEvidenceLedger } from "../src/gai/research-evidence-ledger.ts";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

const item = (id: string, kind: ResearchEvidence["kind"]): ResearchEvidence => ({
  id,
  stage: "R1",
  kind,
  verified: true,
  source: "test",
  collectedAt: "2026-09-11T00:00:00.000Z",
});

test("ledger persists and deduplicates identical evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gai-ledger-"));
  try {
    const file = path.join(dir, "ledger.json");
    const ledger = new ResearchEvidenceLedger(file);
    const first = await ledger.merge([item("a", "internal-baseline")]);
    assert.equal(first.length, 1);
    const second = await ledger.merge([item("a", "internal-baseline"), item("b", "heldout-evaluation")]);
    assert.equal(second.length, 2);
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.schemaVersion, 1);
    assert.equal(raw.evidence.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ledger refuses id collision with a different payload", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gai-ledger-"));
  try {
    const ledger = new ResearchEvidenceLedger(path.join(dir, "ledger.json"));
    await ledger.merge([item("same", "internal-baseline")]);
    await assert.rejects(() => ledger.merge([{ ...item("same", "internal-baseline"), verified: false }]), /collision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
