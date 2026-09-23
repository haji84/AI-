import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { afterEach } from "node:test";
import { CognitiveLocalOutcomeCatalog, loadCognitiveLocalOutcomes, type CognitiveLocalOutcomeManifest } from "../src/gai/cognitive-local-outcomes.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { decodeXlsx } from "../src/orchestrator/local-spreadsheet-capability.ts";
import { decodeDocx } from "../src/orchestrator/local-document-capability.ts";
import type { Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import type { WorkStateAction } from "../src/orchestrator/work-state-integration.ts";
const temporaryDirectories = new Set<string>();
async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.add(directory); return directory;
}
afterEach(async () => {
  for (const directory of temporaryDirectories) {
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw Error("Refusing cleanup outside owned temporary directory");
    await rm(directory, { recursive: true, force: true });
    temporaryDirectories.delete(directory);
  }
});
const goal: Goal = { title: "Convert owner material", successCriteria: ["Requested output matches source"], constraints: [] };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fallback = { async verify() { return { ok: false, summary: "unhandled" }; } };
async function fixture(format: "text" | "workbook-json" | "document-json" = "text", content = "Owner supplied material") {
  const root = await temporaryDirectory("cognitive-outcomes-");
  const domain = format === "text" ? "file" : format === "workbook-json" ? "spreadsheet" : "document";
  const path = domain === "file" ? "result.txt" : domain === "spreadsheet" ? "result.xlsx" : "result.docx";
  await writeFile(join(root, "source.json"), content);
  const manifest: CognitiveLocalOutcomeManifest = { version: 1, goalId: "goal-owner", materials: [{ id: "source", path: "source.json", sha256: hash(content), format }], outcomes: [{ id: "result", materialId: "source", path, domain, criteria: ["criterion-1"] }] };
  return { root, manifest, content, path };
}
function runtime(root: string, manifest: CognitiveLocalOutcomeManifest) {
  const catalog = new CognitiveLocalOutcomeCatalog(root, manifest, "goal-owner", goal);
  const registry = new CapabilityRegistry(); catalog.register(registry);
  const verifier = catalog.verifier(fallback);
  const run = async (action: ProposedAction) => {
    const result = await registry.execute(action, []);
    const verification = await verifier.verify({ goal, action, result, context: [] });
    return { result, verification };
  };
  return { catalog, registry, verifier, run };
}

test("outcomes compile source inspection before exact text/XLSX/DOCX creation without a step manifest", async () => {
  const cases = [
    { format: "text" as const, content: "Owner line one\nOwner line two", expected: "Owner line one\nOwner line two" },
    { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Summary", cell: "A1", value: "amount" }, { sheet: "Summary", cell: "B1", value: 42 }] }), expected: { cells: [{ sheet: "Summary", cell: "A1", value: "amount" }, { sheet: "Summary", cell: "B1", value: 42 }] } },
    { format: "document-json" as const, content: JSON.stringify({ title: "Owner report", sections: { Summary: "Verified supplied facts" } }), expected: { title: "Owner report", sections: { Summary: "Verified supplied facts" } } },
  ];
  for (const item of cases) {
    const f = await fixture(item.format, item.content); const r = runtime(f.root, f.manifest);
    const initial = await r.catalog.candidates([]);
    assert.equal(initial.length, 1);
    assert.deepEqual((initial[0].action as WorkStateAction).satisfiesDefinitionOfDone, []);
    assert.equal((await r.run(initial[0].action)).verification.ok, true);
    // A new instance uses the durable verified action ID, not an in-memory read flag.
    const restarted = runtime(f.root, f.manifest);
    const outputs = (await restarted.catalog.candidates([initial[0].id])).filter(c => c.action.capability.startsWith("cognitive.outcome."));
    assert.equal(outputs.length, 1);
    assert.deepEqual((outputs[0].action as WorkStateAction).satisfiesDefinitionOfDone, ["criterion-1"]);
    const completed = await restarted.run(outputs[0].action);
    assert.equal(completed.result.ok, true, completed.result.summary);
    assert.equal(completed.verification.ok, true, completed.verification.summary);
    const bytes = await readFile(join(f.root, f.path));
    assert.deepEqual(item.format === "text" ? bytes.toString("utf8") : item.format === "workbook-json" ? decodeXlsx(bytes) : decodeDocx(bytes), item.expected);
    assert.equal((await restarted.run(outputs[0].action)).verification.ok, true);
    assert.equal(JSON.stringify(completed.verification).includes("Owner line"), false);
    assert.ok(JSON.stringify(completed.verification).includes("lineage"));
  }
});

test("source changes invalidate prior action identity and fail writes plus independent verification", async () => {
  const f = await fixture(); const r = runtime(f.root, f.manifest);
  const read = (await r.catalog.candidates())[0];
  const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
  assert.equal((await r.run(output.action)).verification.ok, true);
  await writeFile(join(f.root, "source.json"), "Changed owner material");
  assert.equal((await r.run(output.action)).result.ok, false);
  assert.equal((await r.verifier.verify({ goal, action: output.action, result: { actionId: output.id, ok: true, summary: "forged" }, context: [] })).ok, false);
  const changed = structuredClone(f.manifest); changed.materials[0].sha256 = hash("Changed owner material");
  const next = runtime(f.root, changed);
  assert.notEqual((await next.catalog.candidates())[0].id, read.id);
  assert.equal((await next.catalog.candidates([read.id])).filter(c => c.action.capability.startsWith("cognitive.outcome.")).length, 0);
});

test("output tampering and conflicting replacement cannot satisfy owner criteria", async () => {
  const f = await fixture(); const r = runtime(f.root, f.manifest);
  const read = (await r.catalog.candidates())[0];
  const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
  await writeFile(join(f.root, f.path), "Existing unrelated data");
  assert.equal((await r.run(output.action)).result.ok, false);
  assert.equal((await readFile(join(f.root, f.path), "utf8")), "Existing unrelated data");
  assert.equal((await r.verifier.verify({ goal, action: output.action, result: { actionId: output.id, ok: true, summary: "claimed pass" }, context: [] })).ok, false);
});

test("manifest rejects extra authority fields, unmatched formats, invalid criteria and unsafe paths", async () => {
  const f = await fixture();
  const invalid = [
    { ...f.manifest, steps: [] },
    { ...f.manifest, goalId: "another-goal" },
    { ...f.manifest, outcomes: [{ ...f.manifest.outcomes[0], domain: "spreadsheet" }] },
    { ...f.manifest, outcomes: [{ ...f.manifest.outcomes[0], criteria: [] }] },
    { ...f.manifest, outcomes: [{ ...f.manifest.outcomes[0], criteria: ["criterion-2"] }] },
    { ...f.manifest, outcomes: [{ ...f.manifest.outcomes[0], path: "source.json" }] },
    ...["../escape.txt", "C:\\private.txt", "\\\\server\\share\\x", "file.txt:stream", ".git/config", ".env", "credentials/key", "aux.txt"].map(path => ({ ...f.manifest, outcomes: [{ ...f.manifest.outcomes[0], path }] })),
  ];
  for (const manifest of invalid) assert.throws(() => runtime(f.root, manifest as CognitiveLocalOutcomeManifest));
  const r = runtime(f.root, f.manifest); const read = (await r.catalog.candidates())[0];
  const forged = await r.registry.execute({ ...read.action, input: { path: "../escape" } }, []);
  assert.equal(forged.ok, false);
});

test("oversized, secret, malformed and executable source schemas fail before output creation", async () => {
  const cases = [
    { format: "text" as const, content: "x".repeat(65_537) },
    { format: "text" as const, content: "password=private-value" },
    { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Summary", cell: "A1", formula: "HYPERLINK(\"https://example.invalid\")", value: 1 }] }) },
    { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Summary", cell: "XFE1", value: 1 }] }) },
    { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Summary", cell: "A1048577", value: 1 }] }) },
    { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Summary", cell: "A1", value: 1 }, { sheet: "Summary", cell: "A1", value: 2 }] }) },
    { format: "document-json" as const, content: JSON.stringify({ title: "Report", sections: { Summary: "Safe" }, command: "run executable" }) },
    { format: "document-json" as const, content: '{"title":"Report","sections":{"__proto__":"injected"}}' },
    { format: "workbook-json" as const, content: "invalid JSON" },
  ];
  for (const item of cases) {
    const f = await fixture(item.format, item.content); const r = runtime(f.root, f.manifest);
    const read = (await r.catalog.candidates())[0];
    assert.equal((await r.run(read.action)).result.ok, false);
    const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
    assert.equal((await r.run(output.action)).result.ok, false);
    await assert.rejects(readFile(join(f.root, f.path)), { code: "ENOENT" });
  }
});

test("source symlink escape and bounded configured manifest loading fail closed", async () => {
  const f = await fixture(); const outside = await temporaryDirectory("cognitive-outside-");
  await writeFile(join(outside, "input.txt"), f.content);
  await symlink(outside, join(f.root, "linked"), "junction");
  const linked = structuredClone(f.manifest); linked.materials[0].path = "linked/input.txt";
  const r = runtime(f.root, linked);
  assert.equal((await r.run((await r.catalog.candidates())[0].action)).result.ok, false);
  const manifestPath = join(f.root, "outcomes.json");
  await writeFile(manifestPath, JSON.stringify(f.manifest));
  const loaded = await loadCognitiveLocalOutcomes(manifestPath, f.root, "goal-owner", goal);
  assert.equal((await loaded.candidates()).length, 1);
  await writeFile(manifestPath, " ".repeat(65_537));
  await assert.rejects(loadCognitiveLocalOutcomes(manifestPath, f.root, "goal-owner", goal));
});


test("contract digest binds all material and outcome authority and is stable across restarts", async () => {
  const f = await fixture();
  const original = runtime(f.root, f.manifest).catalog;
  assert.equal(runtime(f.root, structuredClone(f.manifest)).catalog.contractDigest, original.contractDigest);
  const reordered = { outcomes: f.manifest.outcomes, materials: f.manifest.materials, goalId: f.manifest.goalId, version: 1 as const };
  assert.equal(runtime(f.root, reordered).catalog.contractDigest, original.contractDigest);
  const changedSource = structuredClone(f.manifest); changedSource.materials[0].sha256 = hash("Changed source");
  assert.notEqual(runtime(f.root, changedSource).catalog.contractDigest, original.contractDigest);
  const changedOutput = structuredClone(f.manifest); changedOutput.outcomes[0].path = "new-result.txt";
  assert.notEqual(runtime(f.root, changedOutput).catalog.contractDigest, original.contractDigest);
  const otherRoot = await temporaryDirectory("cognitive-outcome-root-");
  assert.notEqual(runtime(otherRoot, f.manifest).catalog.contractDigest, original.contractDigest);
});


test("oversized existing output is refused before the adapter and remains untouched", async () => {
  const f = await fixture(); const r = runtime(f.root, f.manifest);
  const read = (await r.catalog.candidates())[0];
  const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
  const bytes = Buffer.alloc(2 * 1024 * 1024, 120);
  await writeFile(join(f.root, f.path), bytes);
  const result = await r.registry.execute(output.action, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "local_outcome_unavailable");
  assert.deepEqual(await readFile(join(f.root, f.path)), bytes);
});

test("accepted outcome contracts stay inside the Core 32-action budget", async () => {
  const f = await fixture();
  const materials = Array.from({ length: 16 }, (_, index) => ({ ...f.manifest.materials[0], id: `source-${index}`, path: `source-${index}.json` }));
  const outcomes = materials.map((material, index) => ({ ...f.manifest.outcomes[0], id: `output-${index}`, materialId: material.id, path: `output-${index}.txt` }));
  assert.doesNotThrow(() => runtime(f.root, { ...f.manifest, materials, outcomes }));
  assert.throws(() => runtime(f.root, { ...f.manifest, materials: [...materials, { ...materials[0], id: "extra", path: "extra.json" }], outcomes }), /budget|bound/);
});


test("Office output rejects XML 1.0 forbidden characters before creating a deliverable", async () => {
  for (const character of [String.fromCharCode(0xfffe), String.fromCharCode(0xffff)]) {
    for (const item of [
      { format: "workbook-json" as const, content: JSON.stringify({ cells: [{ sheet: "Result", cell: "A1", value: "invalid" + character + "content" }] }) },
      { format: "document-json" as const, content: JSON.stringify({ title: "Report", sections: { Result: "invalid" + character + "content" } }) },
    ]) {
      const f = await fixture(item.format, item.content), r = runtime(f.root, f.manifest);
      const read = (await r.catalog.candidates())[0];
      assert.equal((await r.run(read.action)).verification.ok, false, "unopenable Office material must not be certified");
      const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
      assert.equal((await r.run(output.action)).result.ok, false);
      await assert.rejects(readFile(join(f.root, f.path)), { code: "ENOENT" });
    }
  }
});


test("Office XML normalization cannot silently change supplied text or sheet names", async () => {
  for (const item of [
    { format: "workbook-json" as const, value: { cells: [{ sheet: "Result", cell: "A1", value: "a" + String.fromCharCode(13) + "b" }] } },
    { format: "workbook-json" as const, value: { cells: [{ sheet: "a" + String.fromCharCode(10) + "b", cell: "A1", value: 1 }] } },
    { format: "workbook-json" as const, value: { cells: [{ sheet: "a" + String.fromCharCode(9) + "b", cell: "A1", value: 1 }] } },
    { format: "document-json" as const, value: { title: "Report", sections: { Result: "a" + String.fromCharCode(13, 10) + "b" } } },
  ]) {
    const f = await fixture(item.format, JSON.stringify(item.value)), r = runtime(f.root, f.manifest);
    const read = (await r.catalog.candidates())[0];
    assert.equal((await r.run(read.action)).verification.ok, false);
    const output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
    assert.equal((await r.run(output.action)).result.ok, false);
    await assert.rejects(readFile(join(f.root, f.path)), { code: "ENOENT" });
  }
  const f = await fixture("text", "Plain file" + String.fromCharCode(13, 10) + "keeps CRLF"), r = runtime(f.root, f.manifest);
  const read = (await r.catalog.candidates())[0], output = (await r.catalog.candidates([read.id])).find(c => c.action.capability.startsWith("cognitive.outcome."))!;
  assert.equal((await r.run(output.action)).verification.ok, true);
  assert.equal(await readFile(join(f.root, f.path), "utf8"), f.content);
});
