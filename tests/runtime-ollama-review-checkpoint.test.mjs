import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeDevelopmentVerifier } from '../src/orchestrator/runtime-development-verifier.ts';
const sha = value => createHash('sha256').update(value).digest('hex');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let api;
try { api = await import('../src/orchestrator/runtime-ollama-review-checkpoint.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const jsonResponse = value => new globalThis.Response(JSON.stringify(value), { status: 200 });
const cases = ['lint', 'typecheck', 'unit', 'integration', 'security', 'build'];
function context(source = 'export const value = 1;\n') {
  const root = mkdtempSync(join(tmpdir(), 'goriq-review-stage-test-'));
  const repo = join(root, 'repo'), workspace = join(root, 'candidate'), stateDirectory = join(root, 'state');
  mkdirSync(repo); mkdirSync(stateDirectory);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(repo, 'README.md'), 'fixture\n'); git('add', '.'); git('commit', '-qm', 'fixture');
  const baseRevision = git('rev-parse', 'HEAD'); git('worktree', 'add', '-q', '--detach', workspace, baseRevision);
  mkdirSync(join(workspace, 'src')); writeFileSync(join(workspace, 'src/value.mjs'), source);
  const builder = { name: 'fixture-builder:1', digest: 'b'.repeat(64) };
  const reviewer = { name: 'fixture-reviewer:1', digest: 'c'.repeat(64) };
  const config = { version: 1, workspace, stateDirectory, repository: 'haji84/AI-', pullRequest: 1824,
    baseRevision, allowedPaths: ['src/value.mjs'], builderModels: [builder], reviewer };
  const artifactDigest = sha(source);
  const patchDigest = sha(`create\0src/value.mjs\0${source}`);
  const sourceRevision = sha(`candidate\0${baseRevision}\0${patchDigest}`);
  const input = { verificationContract: { kind: 'repository_checks', profile: 'standard', requiredChecks: cases },
    candidate: { artifactRef: `sha256:${artifactDigest}`, changedPaths: ['src/value.mjs'] },
    releaseBinding: { builderId: 'local-ollama-builder', sourceRevision, artifactDigest } };
  const evidence = { verifierId: 'separate-test-runner', sourceRevision, artifactDigest,
    verificationEvidence: cases.map(check => ({ check, verifierId: 'separate-test-runner', sourceRevision,
      artifactDigest, status: 'passed', recordedAt: '2026-10-30T00:00:00.000Z' })) };
  return { root, config, input, evidence, actionId: 'development-same-job:verify' };
}
function transport(ctx, { verdict = 'PASS', malformed, generateThrows = false, afterGenerate, busy = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body, headers: init.headers });
    if (String(url).endsWith('/verify')) return jsonResponse({ ok: true, summary: 'bound checks', evidence: ctx.evidence });
    if (String(url).endsWith('/api/tags')) return jsonResponse({ models: [...ctx.config.builderModels, ctx.config.reviewer] });
    if (String(url).endsWith('/api/ps')) return jsonResponse({ models: busy ? [{ name: 'other' }] : [] });
    assert.equal(String(url), 'http://127.0.0.1:11434/api/generate');
    if (generateThrows) throw new Error('test transport offline');
    const request = JSON.parse(init.body);
    const binding = JSON.parse(request.prompt.split('\nREVIEW_BINDING=')[1].split('\n')[0]);
    const decision = { artifactDigest: binding.artifactDigest, sourceRevision: binding.sourceRevision,
      testBindingSha256: binding.testBindingSha256, verdict,
      findings: verdict === 'FAIL' ? [{ path: 'src/value.mjs', summary: 'fixture finding', evidence: 'line 1 fixture evidence' }] : [],
      reason: 'Fixture model response, not real inference.' };
    afterGenerate?.();
    return jsonResponse({ model: ctx.config.reviewer.name, done: true, done_reason: 'stop', eval_count: 50,
      response: malformed ?? JSON.stringify(decision) });
  };
  return { fetchImpl, calls };
}
const generations = calls => calls.filter(c => c.url.endsWith('/api/generate')).length;
async function run(ctx, options = {}) {
  assert.equal(typeof api?.reviewRuntimeCandidate, 'function', 'checkpointed runtime review is not implemented');
  const t = transport(ctx, options);
  const result = await api.reviewRuntimeCandidate({ ...ctx, fetchImpl: t.fetchImpl });
  return { result, ...t };
}
const cleanup = ctx => rmSync(ctx.root, { recursive: true, force: true });

if (process.env.GORIQ_REVIEW_TEST_CHILD === '1') {
  const ctx = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { result, calls } = await run(ctx);
  console.log(JSON.stringify({ result, generateCalls: generations(calls) }));
} else {
  test('new runtime entry point exists', () => assert.equal(typeof api?.reviewRuntimeCandidate, 'function'));
  test('actual runtime verifier runs separate review after bound checks', async () => {
    const ctx = context();
    try {
      const t = transport(ctx);
      const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_TOKEN: 'fixture-token',
        GORIQ_LOCAL_REVIEW_CONFIG_JSON: JSON.stringify(ctx.config) }, t.fetchImpl);
      const result = await verifier.verify({ goal: { title: 'real development route', successCriteria: [], constraints: [] },
        action: { id: ctx.actionId, capability: 'code.builder', description: 'verify', risk: 'low', input: ctx.input },
        result: { actionId: ctx.actionId, ok: true, summary: 'built' }, context: [] });
      assert.equal(generations(t.calls), 1, 'existing verifier must invoke the configured additional reviewer');
      assert.equal(result.ok, true);
      assert.equal(result.evidence.localModelReview.formalAI09ReviewExecuted, false);
      assert.equal(result.evidence.localModelReview.mergeAuthorized, false);
      assert.equal(result.evidence.verificationEvidence.length, 6);
      const request = t.calls.find(c => c.url.endsWith('/api/generate'));
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.body.includes('fixture-token'), false);
    } finally { cleanup(ctx); }
  });
  test('same task resumes from receipt without a second model call', async () => {
    const ctx = context(); try {
      assert.equal((await run(ctx)).result.ok, true);
      const resumed = await run(ctx, { generateThrows: true });
      assert.equal(resumed.result.ok, true); assert.equal(resumed.result.reused, true);
      assert.equal(generations(resumed.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('two different Node processes use the same persisted checkpoint', () => {
    const ctx = context(); try {
      const file = join(ctx.root, 'input.json'); writeFileSync(file, JSON.stringify(ctx));
      const child = () => spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), file],
        { cwd: ROOT, env: { ...process.env, GORIQ_REVIEW_TEST_CHILD: '1' }, encoding: 'utf8', timeout: 15000 });
      const first = child(), second = child();
      assert.equal(first.status, 0, first.stderr); assert.equal(second.status, 0, second.stderr);
      const a = JSON.parse(first.stdout), b = JSON.parse(second.stdout);
      assert.equal(a.generateCalls, 1); assert.equal(b.generateCalls, 0);
      assert.equal(b.result.reused, true); assert.equal(b.result.ok, true);
      assert.equal(a.result.receiptDigest, b.result.receiptDigest);
    } finally { cleanup(ctx); }
  });
  test('FAIL is persisted and never retried just to obtain PASS', async () => {
    const ctx = context(); try {
      const first = await run(ctx, { verdict: 'FAIL' }); assert.equal(first.result.ok, false);
      const second = await run(ctx); assert.equal(second.result.status, 'CHANGES_REQUESTED');
      assert.equal(second.result.reused, true); assert.equal(generations(second.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('repaired artifact keeps task and PR but does not reuse old FAIL', async () => {
    const ctx = context(); try {
      const first = await run(ctx, { verdict: 'FAIL' });
      const source = 'export const value = 2;\n'; writeFileSync(join(ctx.config.workspace, 'src/value.mjs'), source);
      const artifactDigest = sha(source), sourceRevision = sha(`candidate\0${ctx.config.baseRevision}\0${sha(`create\0src/value.mjs\0${source}`)}`);
      ctx.input.releaseBinding = { ...ctx.input.releaseBinding, artifactDigest, sourceRevision };
      ctx.input.candidate.artifactRef = `sha256:${artifactDigest}`;
      ctx.evidence.artifactDigest = artifactDigest; ctx.evidence.sourceRevision = sourceRevision;
      for (const item of ctx.evidence.verificationEvidence) Object.assign(item, { artifactDigest, sourceRevision });
      const repaired = await run(ctx);
      assert.equal(repaired.result.ok, true); assert.equal(repaired.result.reused, false);
      assert.notEqual(repaired.result.receiptDigest, first.result.receiptDigest);
      assert.equal(repaired.result.taskKey, first.result.taskKey);
      const oldReceipt = JSON.parse(readFileSync(first.result.receiptPath, 'utf8'));
      assert.equal(JSON.parse(oldReceipt.body.observation.response).verdict, 'FAIL');
    } finally { cleanup(ctx); }
  });
  for (const [name, mutate] of [
    ['same builder/reviewer model', c => { c.config.reviewer = { ...c.config.builderModels[0] }; }],
    ['same weights behind different model names', c => { c.config.reviewer.digest = c.config.builderModels[0].digest; }],
    ['candidate bytes differ from evidence', c => { writeFileSync(join(c.config.workspace, 'src/value.mjs'), 'changed'); }],
    ['unsafe target path', c => { c.input.candidate.changedPaths = ['../outside.mjs']; }],
    ['state stored inside candidate workspace', c => { c.config.stateDirectory = join(c.config.workspace, 'state'); }],
    ['stale source revision', c => { c.input.releaseBinding.sourceRevision = 'd'.repeat(64); }],
    ['missing bound checks', c => { c.evidence.verificationEvidence = []; }],
    ['failed deterministic check', c => { c.evidence.verificationEvidence[0].status = 'failed'; }],
    ['self-issued deterministic checks', c => { c.evidence.verifierId = 'local-ollama-builder'; }],
    ['unknown config version', c => { c.config.version = 2; }],
    ['empty required checks', c => { c.input.verificationContract.requiredChecks = []; }],
  ]) test(`rejects ${name} before inference`, async () => {
    const ctx = context(); try { mutate(ctx); const out = await run(ctx); assert.equal(out.result.ok, false); assert.equal(generations(out.calls), 0); }
    finally { cleanup(ctx); }
  });
  test('wrong model digest is rejected', async () => {
    const ctx = context(); try {
      const t = transport(ctx);
      const fetchImpl = async (url, init) => String(url).endsWith('/api/tags')
        ? jsonResponse({ models: [...ctx.config.builderModels, { ...ctx.config.reviewer, digest: 'd'.repeat(64) }] }) : t.fetchImpl(url, init);
      assert.equal(typeof api?.reviewRuntimeCandidate, 'function');
      const result = await api.reviewRuntimeCandidate({ ...ctx, fetchImpl });
      assert.equal(result.ok, false); assert.equal(generations(t.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('busy Ollama is not interrupted', async () => {
    const ctx = context(); try { const r = await run(ctx, { busy: true }); assert.equal(r.result.ok, false); assert.equal(generations(r.calls), 0); }
    finally { cleanup(ctx); }
  });
  test('content change during review prevents checkpoint acceptance', async () => {
    const ctx = context(); try {
      const r = await run(ctx, { afterGenerate: () => writeFileSync(join(ctx.config.workspace, 'src/value.mjs'), 'changed') });
      assert.equal(r.result.ok, false);
    } finally { cleanup(ctx); }
  });
  test('invalid model JSON is not saved as success', async () => {
    const ctx = context(); try { const r = await run(ctx, { malformed: '{}' }); assert.equal(r.result.ok, false); assert.notEqual(r.result.status, 'LOCAL_MODEL_REVIEW_PASSED'); }
    finally { cleanup(ctx); }
  });
  test('corrupted persisted receipt is rejected rather than regenerated', async () => {
    const ctx = context(); try {
      const first = await run(ctx); writeFileSync(first.result.receiptPath, '{}');
      const second = await run(ctx); assert.equal(second.result.ok, false); assert.equal(generations(second.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('symlink candidate cannot be reviewed', async () => {
    const ctx = context(); try {
      const file = join(ctx.config.workspace, 'src/value.mjs'); const value = readFileSync(file); rmSync(file);
      const outside = join(ctx.root, 'outside.mjs'); writeFileSync(outside, value); symlinkSync(outside, file);
      const r = await run(ctx); assert.equal(r.result.ok, false); assert.equal(generations(r.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('fresh test timestamps do not rerun the same reviewed candidate', async () => {
    const ctx = context(); try {
      await run(ctx);
      for (const check of ctx.evidence.verificationEvidence) check.recordedAt = '2026-10-30T01:00:00.000Z';
      const next = await run(ctx); assert.equal(next.result.reused, true); assert.equal(generations(next.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('the local checkpoint never grants formal review or merge authority', async () => {
    const ctx = context(); try { const r = await run(ctx); assert.equal(r.result.ok, true);
      assert.equal(r.result.evidenceKind, 'TEST_DOUBLE_NOT_REAL_MODEL');
      assert.equal(r.result.formalAI09ReviewExecuted, false); assert.equal(r.result.githubApprovalSatisfied, false);
      assert.equal(r.result.mergeAuthorized, false);
    } finally { cleanup(ctx); }
  });
  test('an unresolved task lock is not stolen or ignored', async () => {
    const ctx = context(); try {
      const first = await run(ctx);
      rmSync(first.result.receiptPath);
      const lock = join(ctx.config.stateDirectory, first.result.taskKey + '.lock'); writeFileSync(lock, 'old or live owner');
      const next = await run(ctx); assert.equal(next.result.ok, false);
      assert.equal(next.result.blocker, 'LOCAL_REVIEW_IN_PROGRESS_OR_INTERRUPTED'); assert.equal(generations(next.calls), 0);
      assert.equal(readFileSync(lock, 'utf8'), 'old or live owner');
    } finally { cleanup(ctx); }
  });
  test('transport failure is persisted, not silently retried after restart', async () => {
    const ctx = context(); try {
      const failed = await run(ctx, { generateThrows: true }); assert.equal(failed.result.ok, false);
      const resumed = await run(ctx); assert.equal(resumed.result.ok, false);
      assert.equal(resumed.result.reused, true); assert.equal(generations(resumed.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('malformed opt-in config cannot bypass the additional gate', async () => {
    const ctx = context(); try {
      const t = transport(ctx); const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_TOKEN: 'fixture-token',
        GORIQ_LOCAL_REVIEW_CONFIG_JSON: '{' }, t.fetchImpl);
      const r = await verifier.verify({ goal: { title: 'g', successCriteria: [], constraints: [] },
        action: { id: ctx.actionId, capability: 'code.builder', description: 'verify', risk: 'low', input: ctx.input },
        result: { actionId: ctx.actionId, ok: true, summary: 'built' }, context: [] });
      assert.equal(r.ok, false); assert.equal(generations(t.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('model FAIL withholds deterministic evidence from callers that ignore ok', async () => {
    const ctx = context(); try {
      const t = transport(ctx, { verdict: 'FAIL' }); const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_TOKEN: 'fixture-token',
        GORIQ_LOCAL_REVIEW_CONFIG_JSON: JSON.stringify(ctx.config) }, t.fetchImpl);
      const r = await verifier.verify({ goal: { title: 'g', successCriteria: [], constraints: [] },
        action: { id: ctx.actionId, capability: 'code.builder', description: 'verify', risk: 'low', input: ctx.input },
        result: { actionId: ctx.actionId, ok: true, summary: 'built' }, context: [] });
      assert.equal(r.ok, false); assert.equal(r.evidence.verificationEvidence, undefined);
      assert.equal(r.evidence.localModelReview.status, 'CHANGES_REQUESTED');
    } finally { cleanup(ctx); }
  });
  test('parallel invocations never start two inferences for one task', async () => {
    const ctx = context(); let release;
    try {
      const t = transport(ctx);
      const barrier = new Promise(resolve => { release = resolve; });
      let startedResolve; const started = new Promise(resolve => { startedResolve = resolve; });
      const fetchImpl = async (url, init) => {
        if (String(url).endsWith('/api/generate')) { startedResolve(); await barrier; }
        return t.fetchImpl(url, init);
      };
      const first = api.reviewRuntimeCandidate({ ...ctx, fetchImpl });
      await started;
      const second = await api.reviewRuntimeCandidate({ ...ctx, fetchImpl });
      assert.equal(second.blocker, 'LOCAL_REVIEW_IN_PROGRESS_OR_INTERRUPTED');
      release(); assert.equal((await first).ok, true); assert.equal(generations(t.calls), 1);
    } finally { release?.(); cleanup(ctx); }
  });
  test('altering the evidence class cannot turn a test double into a real observation', async () => {
    const ctx = context(); try {
      const first = await run(ctx); const saved = JSON.parse(readFileSync(first.result.receiptPath, 'utf8'));
      saved.body.evidenceKind = 'LOCAL_OLLAMA_OBSERVATION';
      const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
        : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
        : JSON.stringify(value);
      saved.sha256 = sha(canonical(saved.body)); writeFileSync(first.result.receiptPath, JSON.stringify(saved));
      const next = await run(ctx); assert.equal(next.result.ok, false); assert.equal(generations(next.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('INCONCLUSIVE stays unresolved after restart', async () => {
    const ctx = context(); try {
      const first = await run(ctx, { verdict: 'INCONCLUSIVE' }); assert.equal(first.result.ok, false);
      const resumed = await run(ctx); assert.equal(resumed.result.status, 'INCONCLUSIVE'); assert.equal(generations(resumed.calls), 0);
    } finally { cleanup(ctx); }
  });
  test('changed check contract invalidates the previous review checkpoint', async () => {
    const ctx = context(); try {
      const first = await run(ctx); ctx.input.verificationContract.profile = 'expanded';
      const changed = await run(ctx); assert.equal(changed.result.ok, true); assert.equal(generations(changed.calls), 1);
      assert.notEqual(first.result.receiptDigest, changed.result.receiptDigest);
      assert.equal(first.result.taskKey, changed.result.taskKey);
    } finally { cleanup(ctx); }
  });
  test('review for another PR cannot reuse the first PR checkpoint', async () => {
    const ctx = context(); try {
      const first = await run(ctx); ctx.config.pullRequest = 1825;
      const next = await run(ctx); assert.equal(next.result.ok, true); assert.equal(generations(next.calls), 1);
      assert.notEqual(next.result.taskKey, first.result.taskKey);
    } finally { cleanup(ctx); }
  });
  test('additional review cannot replace missing original verifier authority', async () => {
    const ctx = context(); try {
      const t = transport(ctx); const verifier = createRuntimeDevelopmentVerifier({ GORIQ_LOCAL_REVIEW_CONFIG_JSON: JSON.stringify(ctx.config) }, t.fetchImpl);
      const result = await verifier.verify({ goal: { title: 'g', successCriteria: [], constraints: [] },
        action: { id: ctx.actionId, capability: 'code.builder', description: 'verify', risk: 'low', input: ctx.input },
        result: { actionId: ctx.actionId, ok: true, summary: 'built' }, context: [] });
      assert.equal(result.ok, false); assert.equal(generations(t.calls), 0);
      assert.equal(readdirSync(ctx.config.stateDirectory).length, 0);
    } finally { cleanup(ctx); }
  });
}
