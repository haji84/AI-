import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { cognitiveDigest } from "../src/gai/cognitive-state.ts";
import type { Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import type { CognitivePublicResearchManifest } from "../src/gai/cognitive-public-research-outcomes.ts";

const url = "https://example.com/api/release", hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const goal: Goal = { title: "公開情報を調べ、出典付きCSVと確認メモを保存", successCriteria: ["CSV contains acquired fields", "Memo cites provenance"], constraints: [] };
const fallback = { async verify() { return { ok: false, summary: "unhandled" }; } };
async function moduleUnderTest() {
  try { return await import("../src/gai/cognitive-public-research-outcomes.ts"); }
  catch (error) { assert.fail(`public research catalog unavailable: ${(error as NodeJS.ErrnoException).code}`); }
}
async function fixture(t: { after(fn: () => Promise<void>): void }, body: unknown = {
  version: "fixture-v9", published: "2000-01-01T00:00:00Z", page: "https://example.org/releases/fixture-v9", unapproved: { raw_personal_data: "UNAPPROVED_PERSON" },
}) {
  const root = await mkdtemp(join(tmpdir(), "public-research-outcome-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const manifest: CognitivePublicResearchManifest = { version: 1, goalId: "goal-fixture", goalDigest: cognitiveDigest(goal), sources: [{ id: "release", url }],
    outcomes: [{ id: "release-report", sourceId: "release", fields: [{ jsonField: "version", label: "バージョン" }, { jsonField: "published", label: "公開日時" },
      { jsonField: "page", label: "公式ページ" }], csvPath: "reports/release.csv", memoPath: "reports/release.md", criteria: ["criterion-1", "criterion-2"], publishedAtField: "published" }] };
  const sourcePolicyJson = JSON.stringify({ version: 1, sources: [{ url, sourceClass: "official", fields: ["version", "published", "page", "count", "enabled", "empty"] }] });
  let calls = 0; const responses = { body, fail: false };
  const options = { sourcePolicyJson, transport: { resolve: async () => [{ address: "93.184.216.34", family: 4 }], fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
    calls++; assert.equal(String(input), url); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit");
    if (responses.fail) throw Error("private transport detail must not leak");
    return new Response(JSON.stringify(responses.body), { headers: { "content-type": "application/json" } });
  } } };
  const api = await moduleUnderTest();
  const create = () => {
    const catalog = new api.CognitivePublicResearchOutcomeCatalog(root, manifest, "goal-fixture", goal, options);
    const registry = new CapabilityRegistry(); catalog.register(registry);
    return { catalog, registry, verifier: catalog.verifier(fallback) };
  };
  return { root, manifest, options, responses, calls: () => calls, create, body };
}

test("selected public research acquires actual fixture values and writes cited UTF8 CSV plus readable memo", async t => {
  const f = await fixture(t), r = f.create(), candidates = await r.catalog.candidates();
  assert.equal(f.calls(), 0, "listing candidates must not acquire source data");
  assert.equal(candidates.length, 1); assert.equal(candidates[0].kind, "research");
  assert.equal(candidates[0].learningOperation, undefined); assert.deepEqual(candidates[0].action.input, { outcomeId: "release-report" });
  const action = candidates[0].action, result = await r.registry.execute(action, []);
  assert.equal(result.ok, true, result.summary); assert.equal(f.calls(), 1);
  const verification = await r.verifier.verify({ goal, action, result, context: [] });
  assert.equal(verification.ok, true, verification.summary);
  const csv = await readFile(join(f.root, "reports/release.csv"), "utf8"), memo = await readFile(join(f.root, "reports/release.md"), "utf8");
  assert.match(csv, /"version","バージョン","string","fixture-v9"/);
  assert.match(csv, /"published","公開日時","string","2000-01-01T00:00:00Z"/);
  assert.match(csv, /"page","公式ページ","string","https:\/\/example.org\/releases\/fixture-v9"/);
  assert.ok(csv.includes(hash(JSON.stringify(f.body)))); assert.ok(csv.includes(r.catalog.contractDigest));
  assert.ok(memo.includes(`<${url}>`)); assert.ok(memo.includes("バージョン")); assert.ok(memo.replace(/\\(.)/g, "$1").includes("fixture-v9"));
  assert.ok(memo.includes(hash(JSON.stringify(f.body))));
  assert.ok(!csv.includes("UNAPPROVED_PERSON") && !memo.includes("UNAPPROVED_PERSON") && !JSON.stringify(result).includes("UNAPPROVED_PERSON"));
  assert.equal(r.catalog.completionSatisfied([action.id]), true);
});

test("private result bindings reject replay, mutated action, altered provenance and artifact tampering", async t => {
  const f = await fixture(t), r = f.create(), action = (await r.catalog.candidates())[0].action, result = await r.registry.execute(action, []);
  assert.equal((await r.verifier.verify({ goal, action, result: globalThis.structuredClone(result), context: [] })).ok, false);
  assert.equal((await r.verifier.verify({ goal, action: { ...action, input: { outcomeId: "release-report", url: "https://attacker.example/" } }, result, context: [] })).ok, false);
  const tampered = { ...action, description: "different request" };
  assert.equal((await r.registry.execute(tampered, [])).ok, false); assert.equal(f.calls(), 1);
  const originalEvidence = result.evidence; result.evidence = { refs: [], source: "tampered" };
  assert.equal((await r.verifier.verify({ goal, action, result, context: [] })).ok, false); result.evidence = originalEvidence;
  await writeFile(join(f.root, "reports/release.csv"), "forged values");
  assert.equal((await r.verifier.verify({ goal, action, result, context: [] })).ok, false);
  assert.equal(await r.catalog.revalidateCompleted([action.id]), false);
});

test("fresh completion revalidation refetches source and compares actual artifacts without trusting old PASS", async t => {
  const f = await fixture(t), r = f.create(), action = (await r.catalog.candidates())[0].action, result = await r.registry.execute(action, []);
  const verified = await r.verifier.verify({ goal, action, result, context: [] }); assert.equal(verified.ok, true);
  const canonical = [{ itemId: "criterion-1", passed: true, evidence: verified.evidence }];
  const restarted = f.create(); assert.equal(restarted.catalog.completionSatisfied([action.id]), false);
  assert.equal((await restarted.verifier.verify({ goal, action, result, context: [] })).ok, false);
  assert.equal(await restarted.catalog.revalidateCompleted([action.id]), false, "an editable artifact or old PASS alone is not original provenance");
  assert.equal(await restarted.catalog.revalidateCompleted([action.id], canonical), true); assert.equal(f.calls(), 2);
  assert.equal(restarted.catalog.completionSatisfied([action.id]), true);
  assert.match(JSON.stringify(restarted.catalog.completionEvidence()), /canonical/);
  assert.match(JSON.stringify(restarted.catalog.completionEvidence()), /revalidatedAt/);
  f.responses.body = { ...(f.body as object), unapproved: { changed_counter: 987 } };
  const drift = f.create();
  assert.equal(await drift.catalog.revalidateCompleted([action.id], canonical), true, "unrequested public fields do not invalidate verified facts");
  const corrupt = globalThis.structuredClone(canonical);
  (corrupt[0].evidence as { receipts: Array<{ source: { responseSha256: string } }> }).receipts[0].source.responseSha256 = "0".repeat(64);
  assert.equal(await f.create().catalog.revalidateCompleted([action.id], corrupt), false);
  const changed = f.create(); f.responses.body = { ...(f.body as object), version: "fixture-v10" };
  assert.equal(await changed.catalog.revalidateCompleted([action.id], canonical), false);
  assert.ok((await readFile(join(f.root, "reports/release.csv"), "utf8")).includes("fixture-v9"));
});

test("source policy is required and snapshotted; unsafe fields, goals and output scope are refused", async t => {
  const f = await fixture(t), api = await moduleUnderTest();
  assert.throws(() => new api.CognitivePublicResearchOutcomeCatalog(f.root, f.manifest, "goal-fixture", goal, {}));
  for (const mutate of [(m: CognitivePublicResearchManifest) => { m.goalId = "wrong-goal"; },
    (m: CognitivePublicResearchManifest) => { m.goalDigest = "0".repeat(64); }, (m: CognitivePublicResearchManifest) => { m.outcomes[0].fields[0].jsonField = "not-admitted"; },
    (m: CognitivePublicResearchManifest) => { m.outcomes[0].csvPath = "../escape.csv"; }, (m: CognitivePublicResearchManifest) => { m.outcomes[0].memoPath = m.outcomes[0].csvPath; },
    (m: CognitivePublicResearchManifest) => { m.sources[0].url += "?token=forbidden"; }, (m: CognitivePublicResearchManifest) => { m.outcomes[0].criteria = ["criterion-99"]; }]) {
    const manifest = globalThis.structuredClone(f.manifest); mutate(manifest);
    assert.throws(() => new api.CognitivePublicResearchOutcomeCatalog(f.root, manifest, "goal-fixture", goal, f.options));
  }
  const r = f.create(); f.manifest.sources[0].url = "https://attacker.example/"; f.options.sourcePolicyJson = "{}";
  const action = (await r.catalog.candidates())[0].action; assert.equal((await r.registry.execute(action, [])).ok, true); assert.equal(f.calls(), 1);
});

test("missing, nonscalar, excessive, invalid published time and failed acquisition cannot satisfy criteria", async t => {
  for (const body of [{ published: "2000-01-01T00:00:00Z", page: "x" }, { version: { command: "execute me" }, published: "2000-01-01T00:00:00Z", page: "x" },
    { version: "x".repeat(9000), published: "2000-01-01T00:00:00Z", page: "x" }, { version: "v", published: "invalid", page: "x" },
    { version: "v", published: "2001-02-29T00:00:00Z", page: "x" }, { version: "v", published: "2000-02-30T00:00:00Z", page: "x" }]) {
    const f = await fixture(t, body), r = f.create(), action = (await r.catalog.candidates())[0].action, result = await r.registry.execute(action, []);
    assert.equal(result.ok, false); assert.equal((await r.verifier.verify({ goal, action, result, context: [] })).ok, false);
    assert.equal(r.catalog.completionSatisfied([action.id]), false);
  }
  const f = await fixture(t), r = f.create(); f.responses.fail = true;
  const action = (await r.catalog.candidates())[0].action, result = await r.registry.execute(action, []);
  assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("private transport detail"));
});

test("existing unrelated outputs and symlink parents are never overwritten", async t => {
  const f = await fixture(t); await mkdir(join(f.root, "reports")); await writeFile(join(f.root, "reports/release.md"), "unrelated data");
  const r = f.create(), action = (await r.catalog.candidates())[0].action;
  assert.equal((await r.registry.execute(action, [])).ok, false);
  assert.equal(await readFile(join(f.root, "reports/release.md"), "utf8"), "unrelated data");
  await assert.rejects(readFile(join(f.root, "reports/release.csv")));
  const linked = await fixture(t), outside = await mkdtemp(join(tmpdir(), "public-research-outside-"));
  t.after(async () => { await rm(outside, { recursive: true, force: true }); });
  await symlink(outside, join(linked.root, "reports"), "junction");
  const lr = linked.create(), la = (await lr.catalog.candidates())[0].action;
  assert.equal((await lr.registry.execute(la, [])).ok, false); assert.equal(linked.calls(), 0);
  await assert.rejects(readFile(join(outside, "release.csv")));
});

test("generic scalar projection escapes CSV formulas and Markdown instructions instead of executing them", async t => {
  const f = await fixture(t, { version: '=HYPERLINK("https://evil.example/")', published: "2000-01-01T00:00:00Z", page: "<script>alert(1)</script>\n[click](javascript:evil)", count: 42, enabled: true, empty: null });
  f.manifest.outcomes[0].fields.push({ jsonField: "count", label: "Count" }, { jsonField: "enabled", label: "Enabled" }, { jsonField: "empty", label: "Empty" });
  const r = f.create(), action = (await r.catalog.candidates())[0].action, result = await r.registry.execute(action, []);
  assert.equal((await r.verifier.verify({ goal, action, result, context: [] })).ok, true);
  const csv = await readFile(join(f.root, "reports/release.csv"), "utf8"), memo = await readFile(join(f.root, "reports/release.md"), "utf8");
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('"count","Count","number","42"'));
  assert.ok(csv.includes('"enabled","Enabled","boolean","true"')); assert.ok(csv.includes('"empty","Empty","null","null"'));
  assert.ok(!memo.includes("<script>") && !memo.includes("[click](javascript:evil)")); assert.ok(memo.includes("&lt;script&gt;"));
  assert.equal(f.calls(), 1);
  assert.throws(() => r.catalog.skillEvaluationDescriptor(), /unsupported/i);
});

test("partial resume revalidates only completed outcomes before allowing pending outcomes", async t => {
  const f = await fixture(t);
  f.manifest.outcomes.push({ ...globalThis.structuredClone(f.manifest.outcomes[0]), id: "second-report", csvPath: "reports/second.csv", memoPath: "reports/second.md" });
  const initial = f.create(), [first, second] = await initial.catalog.candidates();
  assert.equal(await initial.catalog.revalidateCompleted([]), true); assert.equal(f.calls(), 0);
  const firstResult = await initial.registry.execute(first.action, []);
  const verified = await initial.verifier.verify({ goal, action: first.action, result: firstResult, context: [] }); assert.equal(verified.ok, true);
  const resumed = f.create();
  assert.equal(await resumed.catalog.revalidateCompleted([first.id], [{ itemId: "criterion-1", passed: true, evidence: verified.evidence }]), true);
  assert.equal(resumed.catalog.completionSatisfied([first.id]), false);
  const secondResult = await resumed.registry.execute(second.action, []);
  assert.equal((await resumed.verifier.verify({ goal, action: second.action, result: secondResult, context: [] })).ok, true);
  assert.equal(resumed.catalog.completionSatisfied([first.id, second.id]), true);
  const before = f.calls(); assert.equal(await resumed.catalog.revalidateCompleted(["unknown-action"]), false); assert.equal(f.calls(), before);
});

test("host loader rejects an original data-root symlink before realpath normalization", async t => {
  const f = await fixture(t), api = await moduleUnderTest(), parent = await mkdtemp(join(tmpdir(), "public-research-loader-"));
  t.after(async () => { await rm(parent, { recursive: true, force: true }); });
  const manifestFile = join(f.root, "manifest.json"); await writeFile(manifestFile, JSON.stringify(f.manifest));
  await symlink(f.root, join(parent, "root-alias"), "junction");
  await assert.rejects(api.loadCognitivePublicResearchOutcomes(manifestFile, join(parent, "root-alias"), "goal-fixture", goal, f.options), /root|symlink|unsafe/i);
});
