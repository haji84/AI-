import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleEvent } from './controller.mjs';

// TDD evidence: 2026-11-26, node --test codex-autonomy/controller.test.mjs:
// real no-policy baseline: 23 tests, 0 pass, 23 assertion failures (exit 1), before policy implementation.
// Review fixes: 34 tests, 26 pass / 8 fail before fixes; partial-publication/read regressions then failed 2/2 before their fix.

const controller = fileURLToPath(new URL('./controller.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const task = (id, status = 'pending', extra = {}) => ({ id, status, depends_on: [], actionable: true, evidence: [], ...extra });
function fixture(t, extra = {}, beforeCleanup = null) {
  const canonicalTemp = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(canonicalTemp, 'codex-autonomy-test-'));
  t.after(async () => {
    if (beforeCleanup) await beforeCleanup();
    const resolved = fs.realpathSync(root), relative = path.relative(canonicalTemp, resolved);
    assert.ok(relative.startsWith('codex-autonomy-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'cleanup stays within its canonical fixture directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const cwd = path.join(root, 'project'), home = path.join(root, 'home');
  fs.mkdirSync(path.join(cwd, '.codex'), { recursive: true });
  fs.mkdirSync(home);
  const state = { version: 1, goal: { id: 'goal-1', title: 'Fixture goal', acceptance: ['Evidence exists'] },
    status: 'active', tasks: [task('a')], next_action: 'Implement task a', ...extra };
  const relativeState = '.codex/autonomy-state.json';
  const write = () => fs.writeFileSync(path.join(cwd, relativeState), JSON.stringify(state));
  write();
  const cli = args => spawnSync(process.execPath, [controller, ...args], {
    env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', timeout: 10000
  });
  const bind = (session = 'session-1') => {
    const result = cli(['bind', '--cwd', cwd, '--state', relativeState, '--session', session]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).bound, true);
    return result;
  };
  const event = (name, fields = {}, now = Date.now()) => handleEvent({ hook_event_name: name,
    session_id: 'session-1', cwd, turn_id: 'turn-1', ...fields }, { home, now });
  const evidence = (id = 'a', content = 'checked output') => {
    const relative = `evidence-${id}.txt`;
    fs.writeFileSync(path.join(cwd, relative), content);
    return { path: relative, sha256: digest(content) };
  };
  const audit = () => ['events.previous.jsonl', 'events.jsonl'].flatMap(name => {
    const file = path.join(home, 'autonomy', 'runs', name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  });
  return { root, cwd, home, state, relativeState, write, cli, bind, event, evidence, audit };
}
function blocked(output) { assert.equal(output.decision, 'block', JSON.stringify(output)); assert.ok(output.reason); }
function allowed(output) { assert.notEqual(output.decision, 'block', JSON.stringify(output)); }
function warning(output, code) { allowed(output); assert.match(output.systemMessage || '', new RegExp(code)); }
function halted(output, code) { allowed(output); assert.equal(output.continue, false); assert.match(output.stopReason || '', new RegExp(code)); }
function launch(args, env, input, { keepOpen = false } = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const result = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr })); });
  if (keepOpen) { if (input !== undefined) child.stdin.write(input); } else child.stdin.end(input);
  return { child, result };
}
async function until(predicate, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'timed out waiting for process barrier'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('an idle session receives its id but is never automatically armed', t => {
  const f = fixture(t);
  const start = f.event('SessionStart', { source: 'startup' });
  assert.equal(start.hookSpecificOutput?.hookEventName, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /session-1/);
  allowed(f.event('Stop'));
});

test('an explicitly bound incomplete goal blocks Stop and exposes its state reference', t => {
  const f = fixture(t); f.bind();
  blocked(f.event('Stop', { permission_mode: 'dontAsk', stop_hook_active: false }));
  const start = f.event('SessionStart', { source: 'resume' });
  assert.match(start.hookSpecificOutput.additionalContext, /autonomy-state\.json/);
});

test('an ordinary question disarms the binding until an explicit later bind', t => {
  const f = fixture(t); f.bind();
  allowed(f.event('UserPromptSubmit', { prompt: 'What does this function mean?' }));
  allowed(f.event('Stop'));
  f.bind(); blocked(f.event('Stop'));
});

test('only one exact pending continuation survives UserPromptSubmit', t => {
  const f = fixture(t); f.bind();
  const first = f.event('Stop'); blocked(first);
  f.event('UserPromptSubmit', { prompt: first.reason });
  blocked(f.event('Stop', { stop_hook_active: true }));
  f.event('UserPromptSubmit', { prompt: first.reason });
  allowed(f.event('Stop'));
});

for (const event of ['Interrupt', 'UserPromptSubmit']) test(`${event} remains latched when the shared lock is busy`, t => {
  const f = fixture(t); f.bind();
  const lock = path.join(f.home, 'autonomy', 'runs', '.lock'); fs.mkdirSync(lock);
  try { const output = f.event(event, { prompt: 'An ordinary owner question' }); warning(output, 'CONTROLLER_BUSY'); assert.notEqual(output.continue, false); }
  finally { fs.rmdirSync(lock); }
  allowed(f.event('Stop'));
  f.bind(); blocked(f.event('Stop'));
});

test('an exact own continuation remains valid if its prompt handler encounters the busy lock', t => {
  const f = fixture(t); f.bind(); const first = f.event('Stop'); blocked(first);
  const lock = path.join(f.home, 'autonomy', 'runs', '.lock'); fs.mkdirSync(lock);
  try { const output = f.event('UserPromptSubmit', { prompt: first.reason }); warning(output, 'CONTROLLER_BUSY'); assert.notEqual(output.continue, false); }
  finally { fs.rmdirSync(lock); }
  blocked(f.event('Stop'));
});

test('a partially written control signal cannot prevent a later Interrupt from being latched', t => {
  const f = fixture(t); f.bind();
  const directory = path.join(f.home, 'autonomy', 'runs', 'controls', digest('session-1')); fs.mkdirSync(directory, { recursive: true });
  const partial = path.join(directory, 'signal-00.json'); fs.writeFileSync(partial, '{');
  allowed(f.event('Interrupt'));
  fs.unlinkSync(partial);
  allowed(f.event('Stop'));
});

test('a transient binding read failure cannot prevent an ordinary owner prompt from being latched', t => {
  const f = fixture(t); f.bind();
  const file = path.join(f.home, 'autonomy', 'runs', 'bindings', `${digest('session-1')}.json`), before = fs.readFileSync(file);
  fs.writeFileSync(file, '{'); const output = f.event('UserPromptSubmit', { prompt: 'A new ordinary question' }); allowed(output); assert.notEqual(output.continue, false);
  fs.writeFileSync(file, before);
  allowed(f.event('Stop'));
});

test('bind cannot acknowledge an Interrupt arriving after bind started waiting for its lock', async t => {
  const f = fixture(t); f.bind();
  const lock = path.join(f.home, 'autonomy', 'runs', '.lock'); fs.mkdirSync(lock);
  const barrier = path.join(f.root, 'bind-waiting');
  // Observe the real mkdir call without altering it; this makes the cross-process timing deterministic.
  const observer = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const mkdir=fs.mkdirSync; fs.mkdirSync=function(file,...args) { if(String(file).endsWith('.lock')) fs.writeFileSync(process.env.TEST_BIND_BARRIER,'1'); return mkdir.call(this,file,...args); }; syncBuiltinESMExports();`;
  const binding = launch(['--import', `data:text/javascript,${encodeURIComponent(observer)}`, controller,
    'bind', '--cwd', f.cwd, '--state', f.relativeState, '--session', 'session-1'], { CODEX_HOME: f.home, TEST_BIND_BARRIER: barrier });
  let interrupt;
  t.after(() => { binding.child.kill(); interrupt?.child.kill(); if (fs.existsSync(lock)) fs.rmdirSync(lock); });
  await until(() => fs.existsSync(barrier));
  interrupt = launch([controller], { CODEX_HOME: f.home }, JSON.stringify({ hook_event_name: 'Interrupt', session_id: 'session-1', cwd: f.cwd }));
  const controls = path.join(f.home, 'autonomy', 'runs', 'controls', digest('session-1'));
  await until(() => fs.existsSync(controls) && fs.readdirSync(controls).some(name => name.startsWith('signal-')));
  fs.rmdirSync(lock);
  const [bound, interrupted] = await Promise.all([binding.result, interrupt.result]);
  assert.equal(bound.code, 0, bound.stderr || bound.stdout); assert.equal(JSON.parse(bound.stdout).bound, true);
  assert.equal(interrupted.code, 0, interrupted.stderr); allowed(JSON.parse(interrupted.stdout));
  allowed(f.event('Stop'));
});

test('control signal retention is bounded and saturation keeps Stop fail-open', t => {
  const f = fixture(t); f.bind();
  for (let i = 0; i < 65; i++) allowed(f.event('UserPromptSubmit', { prompt: `Question ${i}` }));
  warning(f.event('Stop'), 'CONTROL_CAPACITY');
  const directory = path.join(f.home, 'autonomy', 'runs', 'controls', digest('session-1'));
  assert.ok(fs.readdirSync(directory).length <= 65);
  const result = f.cli(['bind', '--cwd', f.cwd, '--state', f.relativeState, '--session', 'session-1']);
  assert.notEqual(result.status, 0); assert.match(result.stdout, /CONTROL_CAPACITY/);
});

test('a blocked task does not prevent an independent actionable failed task', t => {
  const f = fixture(t, { tasks: [task('blocked', 'blocked', { actionable: false }), task('failed', 'failed')] });
  f.bind(); blocked(f.event('Stop'));
});

test('dependencies require verified evidence before dependent work is actionable', t => {
  const f = fixture(t, { tasks: [task('a', 'blocked'), task('b', 'pending', { depends_on: ['a'] })] });
  f.bind(); warning(f.event('Stop'), 'NO_ACTIONABLE');
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write();
  blocked(f.event('Stop'));
});

test('a complete goal with actual matching evidence stops cleanly without changing canonical state', t => {
  const f = fixture(t, { status: 'complete' });
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write();
  const before = fs.readFileSync(path.join(f.cwd, f.relativeState));
  f.bind(); assert.deepEqual(f.event('Stop'), {});
  assert.deepEqual(fs.readFileSync(path.join(f.cwd, f.relativeState)), before);
});

test('missing or changed evidence becomes unfinished verification and cannot certify completion', t => {
  const f = fixture(t);
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write(); f.bind();
  fs.unlinkSync(path.join(f.cwd, 'evidence-a.txt'));
  const missing = f.event('Stop'); blocked(missing); assert.match(missing.reason, /EVIDENCE_REQUIRED/);
  f.state.status = 'complete'; f.state.tasks[0].actionable = false; f.write(); warning(f.event('Stop'), 'COMPLETE_UNVERIFIED');
  fs.writeFileSync(path.join(f.cwd, 'evidence-a.txt'), 'tampered');
  warning(f.event('Stop'), 'COMPLETE_UNVERIFIED');
});

for (const condition of ['missing', 'changed']) test(`an actionable false-complete claim requests bounded evidence repair for ${condition} evidence`, t => {
  const f = fixture(t, { status: 'complete' });
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write(); f.bind();
  if (condition === 'missing') fs.unlinkSync(path.join(f.cwd, 'evidence-a.txt'));
  else fs.writeFileSync(path.join(f.cwd, 'evidence-a.txt'), 'wrong output');
  const repair = f.event('Stop'); blocked(repair); assert.match(repair.reason, /EVIDENCE_REQUIRED/);
  blocked(f.event('Stop')); warning(f.event('Stop'), 'NO_PROGRESS_LIMIT');
});

test('paused, cancelled, approval, resource, and blocked statuses never force continuation', t => {
  const f = fixture(t); f.bind();
  for (const status of ['paused', 'cancelled', 'awaiting_approval', 'resource_limited', 'blocked']) {
    f.state.status = status; f.write(); allowed(f.event('Stop'));
  }
  f.state.status = 'active'; f.write(); allowed(f.event('Stop', { permission_mode: 'plan' }));
});

test('a continuation cap persists through a same-goal bind and a different session', t => {
  const f = fixture(t, { limits: { maxContinuations: 1, maxNoProgress: 2, maxMinutes: 20 } });
  f.bind(); blocked(f.event('Stop')); f.bind();
  warning(f.event('Stop'), 'CONTINUATION_LIMIT');
  f.bind('session-2'); warning(f.event('Stop', { session_id: 'session-2' }), 'CONTINUATION_LIMIT');
});

test('no-progress detection ignores changes to next_action prose', t => {
  const f = fixture(t); f.bind();
  const first = f.event('Stop'); blocked(first); f.event('UserPromptSubmit', { prompt: first.reason });
  f.state.next_action = 'A freshly worded plan'; f.write();
  const second = f.event('Stop'); blocked(second); f.event('UserPromptSubmit', { prompt: second.reason });
  f.state.next_action = 'Yet another description'; f.write();
  warning(f.event('Stop'), 'NO_PROGRESS_LIMIT');
  f.bind(); warning(f.event('Stop'), 'NO_PROGRESS_LIMIT');
});

test('newly verified real evidence resets no-progress without resetting continuation counts', t => {
  const f = fixture(t, { tasks: [task('a'), task('b'), task('c')] }); f.bind();
  blocked(f.event('Stop')); blocked(f.event('Stop'));
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write();
  blocked(f.event('Stop'));
  warning(f.event('Stop'), 'CONTINUATION_LIMIT');
});

test('verified-task regression cannot reset the no-progress limit', t => {
  const f = fixture(t, { tasks: [task('a'), task('b')] });
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write(); f.bind();
  blocked(f.event('Stop')); blocked(f.event('Stop'));
  f.state.tasks[0] = task('a'); f.write();
  warning(f.event('Stop'), 'NO_PROGRESS_LIMIT');
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write();
  warning(f.event('Stop'), 'NO_PROGRESS_LIMIT');
});

test('state-supplied continuation limits cannot exceed the hard ceiling', t => {
  const f = fixture(t, { tasks: Array.from({ length: 7 }, (_, i) => task(`t${i}`)),
    limits: { maxContinuations: 999, maxNoProgress: 999, maxMinutes: 999 } }); f.bind();
  for (let i = 0; i < 5; i++) {
    f.state.tasks[i] = task(`t${i}`, 'verified', { evidence: [f.evidence(`t${i}`)] }); f.write();
    blocked(f.event('Stop'));
  }
  warning(f.event('Stop'), 'CONTINUATION_LIMIT');
});

test('wall-clock limits remain exhausted after rebind', t => {
  const f = fixture(t); f.bind();
  const later = Date.now() + 21 * 60_000;
  warning(f.event('Stop', {}, later), 'TIME_LIMIT');
  f.bind(); warning(f.event('Stop', {}, later), 'TIME_LIMIT');
});

test('corrupted resource metadata fails open instead of resetting exhausted goal counters', t => {
  const f = fixture(t, { limits: { maxContinuations: 1 } }); f.bind(); blocked(f.event('Stop'));
  const directory = path.join(f.home, 'autonomy', 'runs', 'goals');
  const [name] = fs.readdirSync(directory); assert.ok(name);
  fs.writeFileSync(path.join(directory, name), 'null');
  warning(f.event('Stop'), 'METADATA_INVALID');
  const result = f.cli(['bind', '--cwd', f.cwd, '--state', f.relativeState, '--session', 'session-1']);
  assert.notEqual(result.status, 0); assert.match(result.stdout, /METADATA_INVALID/);
});

test('Interrupt latches pause and only an explicit bind can resume', t => {
  const f = fixture(t); f.bind();
  const continuation = f.event('Stop'); blocked(continuation);
  allowed(f.event('Interrupt')); allowed(f.event('Stop'));
  f.event('UserPromptSubmit', { prompt: continuation.reason }); allowed(f.event('Stop'));
  f.event('SessionStart', { source: 'resume' }); allowed(f.event('Stop'));
  f.bind(); blocked(f.event('Stop'));
});

test('a read-only projection is rejected when its source becomes stale', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.cwd, 'source.json'), '{"native":"state"}');
  f.state.source = { path: 'source.json', sha256: digest('{"native":"state"}') }; f.write(); f.bind();
  fs.writeFileSync(path.join(f.cwd, 'source.json'), '{"native":"changed"}');
  warning(f.event('Stop'), 'SOURCE_STALE');
});

test('relative path traversal is rejected without arming a session', t => {
  const f = fixture(t);
  const result = f.cli(['bind', '--cwd', f.cwd, '--state', '../outside.json', '--session', 'session-1']);
  assert.notEqual(result.status, 0); assert.match(result.stdout, /UNSAFE_PATH/);
  allowed(f.event('Stop'));
  f.state.tasks[0].evidence = [{ path: '../outside.txt', sha256: 'a'.repeat(64) }]; f.write();
  const evidenceResult = f.cli(['bind', '--cwd', f.cwd, '--state', f.relativeState, '--session', 'session-1']);
  assert.notEqual(evidenceResult.status, 0); assert.match(evidenceResult.stdout, /UNSAFE_PATH/);
});

test('a symlink or junction in project evidence, state, or runtime paths is rejected', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'state.json'), JSON.stringify(f.state));
  try { fs.symlinkSync(outside, path.join(f.cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) return t.skip(`Symlinks unavailable: ${error.code}`); throw error; }
  const result = f.cli(['bind', '--cwd', f.cwd, '--state', 'linked/state.json', '--session', 'session-1']);
  assert.notEqual(result.status, 0); assert.match(result.stdout, /UNSAFE_PATH/);
  f.bind();
  f.state.tasks[0] = task('a', 'verified', { evidence: [{ path: 'linked/state.json', sha256: digest(JSON.stringify(f.state)) }] });
  f.write(); warning(f.event('Stop'), 'UNSAFE_PATH');
  const otherHome = path.join(f.root, 'unsafe-home'); fs.mkdirSync(otherHome);
  fs.symlinkSync(outside, path.join(otherHome, 'autonomy'), process.platform === 'win32' ? 'junction' : 'dir');
  warning(handleEvent({ hook_event_name: 'Stop', session_id: 's', cwd: f.cwd }, { home: otherHome }), 'UNSAFE_PATH');
  assert.deepEqual(fs.readdirSync(outside), ['state.json']);
});

test('malformed and oversized canonical files fail open with a visible warning', t => {
  const f = fixture(t); f.bind();
  fs.writeFileSync(path.join(f.cwd, f.relativeState), '{'); warning(f.event('Stop'), 'STATE_INVALID');
  fs.writeFileSync(path.join(f.cwd, f.relativeState), ' '.repeat(131073)); warning(f.event('Stop'), 'FILE_TOO_LARGE');
});

test('malformed state shapes and duplicate task ids cannot arm the controller', t => {
  const f = fixture(t);
  for (const value of [[], { ...f.state, version: 2 }, { ...f.state, tasks: [task('a'), task('a')] },
    { ...f.state, limits: { maxContinuations: -1 } }]) {
    fs.writeFileSync(path.join(f.cwd, f.relativeState), JSON.stringify(value));
    const result = f.cli(['bind', '--cwd', f.cwd, '--state', f.relativeState, '--session', 'session-1']);
    assert.notEqual(result.status, 0); assert.match(result.stdout, /STATE_INVALID/);
  }
});

test('CLI accepts bounded JSON and stops requests with malformed, invalid, or excessive input', t => {
  const f = fixture(t); f.bind();
  for (const input of ['{', 'null', '[]', '{}', ' '.repeat(1048577)]) {
    const result = spawnSync(process.execPath, [controller], { input, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, CODEX_HOME: f.home } });
    assert.equal(result.status, 0, result.stderr); halted(JSON.parse(result.stdout), 'INPUT_');
  }
  const result = spawnSync(process.execPath, [controller], { input: JSON.stringify({ hook_event_name: 'Stop',
    session_id: 'session-1', cwd: f.cwd }), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CODEX_HOME: f.home } });
  assert.equal(result.status, 0, result.stderr); blocked(JSON.parse(result.stdout));
});

test('substantial ordinary questions within the one MiB input budget disarm the previously active goal through the real CLI', t => {
  const f = fixture(t);
  for (const prompt of ['Question: ' + 'x'.repeat(100000), '質問: ' + 'あ'.repeat(250000)]) {
    f.bind();
    const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', cwd: f.cwd, prompt });
    assert.ok(Buffer.byteLength(input) > 65536 && Buffer.byteLength(input) < 1048576);
    const submitted = spawnSync(process.execPath, [controller], { input, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, CODEX_HOME: f.home } });
    const stopped = spawnSync(process.execPath, [controller], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'session-1', cwd: f.cwd }),
      encoding: 'utf8', timeout: 5000, env: { ...process.env, CODEX_HOME: f.home } });
    assert.equal(stopped.status, 0, stopped.stderr); allowed(JSON.parse(stopped.stdout));
    assert.equal(submitted.status, 0, submitted.stderr); assert.deepEqual(JSON.parse(submitted.stdout), {});
  }
});

test('a valid owner prompt exceeding the bounded input budget stops that native request', t => {
  const f = fixture(t); f.bind();
  const result = spawnSync(process.execPath, [controller], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit',
    session_id: 'session-1', cwd: f.cwd, prompt: 'x'.repeat(1048576) }), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CODEX_HOME: f.home } });
  assert.equal(result.status, 0, result.stderr); halted(JSON.parse(result.stdout), 'INPUT_TOO_LARGE');
});

test('incomplete stdin times out with a native request stop instead of proceeding with a stale binding', async t => {
  const f = fixture(t); f.bind();
  const pending = launch([controller], { CODEX_HOME: f.home }, '{"hook_event_name":"UserPromptSubmit"', { keepOpen: true });
  t.after(() => pending.child.kill());
  const result = await pending.result;
  assert.equal(result.code, 0, result.stderr); halted(JSON.parse(result.stdout), 'INPUT_TIMEOUT');
});

test('unrecordable ordinary prompts halt their request while valid Interrupt and Stop failures remain nonblocking', t => {
  const f = fixture(t); f.bind();
  const directory = path.join(f.home, 'autonomy', 'runs', 'controls', digest('session-1'));
  fs.writeFileSync(directory, 'invalid control directory');
  halted(f.event('UserPromptSubmit', { prompt: 'A new ordinary question' }), 'UNSAFE_PATH');
  const result = spawnSync(process.execPath, [controller], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit',
    session_id: 'session-1', cwd: f.cwd, prompt: 'Another ordinary question' }), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CODEX_HOME: f.home } });
  assert.equal(result.status, 0, result.stderr); halted(JSON.parse(result.stdout), 'UNSAFE_PATH');
  for (const event of ['Interrupt', 'Stop']) { const output = f.event(event); warning(output, 'UNSAFE_PATH'); assert.notEqual(output.continue, false); }
});

test('hook revision mismatch allows Stop before running policy or consuming goal resources', t => {
  const f = fixture(t); f.bind();
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'session-1', cwd: f.cwd });
  const options = { input, encoding: 'utf8', timeout: 5000, env: { ...process.env, CODEX_HOME: f.home } };
  const before = f.audit().length;
  const mismatch = spawnSync(process.execPath, [controller, '--revision', 'a'.repeat(64)], options);
  assert.equal(mismatch.status, 0, mismatch.stderr); warning(JSON.parse(mismatch.stdout), 'REVISION_MISMATCH');
  assert.equal(f.audit().length, before);
  const revision = digest(fs.readFileSync(controller));
  const matching = spawnSync(process.execPath, [controller, '--revision', revision], options);
  assert.equal(matching.status, 0, matching.stderr); blocked(JSON.parse(matching.stdout));
});

test('audit files contain metadata and hashes without prompts, transcripts, or canonical contents', t => {
  const f = fixture(t); f.state.goal.title = 'PRIVATE_STATE_SENTINEL'; f.write(); f.bind();
  f.event('SubagentStart', { agent_id: 'agent-1', agent_type: 'worker', prompt: 'PRIVATE_PROMPT_SENTINEL' });
  f.event('SubagentStop', { agent_id: 'agent-1', last_assistant_message: 'PRIVATE_TRANSCRIPT_SENTINEL' });
  f.event('UserPromptSubmit', { prompt: 'PRIVATE_PROMPT_SENTINEL' });
  const events = f.audit(); assert.ok(events.length >= 3);
  const raw = JSON.stringify(events); assert.doesNotMatch(raw, /PRIVATE_/);
  assert.ok(events.some(event => event.agent_id === 'agent-1'));
  for (const event of events) {
    assert.ok(event.reason_code); assert.ok(event.time); assert.ok(event.event);
    assert.ok(Object.keys(event).every(key => ['event', 'time', 'session_id', 'turn_id', 'agent_id', 'agent_type', 'state_hash', 'reason_code',
      'last_assistant_message_sha256', 'end_state', 'task_count', 'verified_task_count', 'evidence_count'].includes(key)));
  }
});

test('SubagentStop audits a claim digest and actual state snapshot without declaring success', t => {
  const f = fixture(t, { tasks: [task('a'), task('b')] });
  f.state.tasks[0] = task('a', 'verified', { evidence: [f.evidence()] }); f.write(); f.bind();
  const message = 'PRIVATE_SUBAGENT_CLAIM: everything succeeded';
  assert.deepEqual(f.event('SubagentStop', { agent_id: 'worker-1', last_assistant_message: message }), {});
  const entry = f.audit().find(event => event.agent_id === 'worker-1');
  assert.equal(entry.last_assistant_message_sha256, digest(message));
  assert.equal(entry.end_state, 'stopped-reported');
  assert.equal(entry.state_hash, digest(fs.readFileSync(path.join(f.cwd, f.relativeState))));
  assert.equal(entry.task_count, 2); assert.equal(entry.verified_task_count, 1); assert.equal(entry.evidence_count, 1);
  assert.doesNotMatch(JSON.stringify(entry), /PRIVATE_SUBAGENT_CLAIM|success/i);
  fs.writeFileSync(path.join(f.cwd, f.relativeState), '{');
  allowed(f.event('SubagentStop', { agent_id: 'worker-invalid', last_assistant_message: 'claim' }));
  const unavailable = f.audit().find(event => event.agent_id === 'worker-invalid');
  assert.equal(unavailable.end_state, 'stopped-reported'); assert.equal(unavailable.state_hash, undefined);
});

test('concurrent subagent events retain every metadata audit record', { timeout: 15000 }, async t => {
  const children = new Set(), pending = new Set(), results = new Array(24); let next = 0, stopping = false;
  const stop = () => { stopping = true; for (const child of children) child.kill('SIGKILL'); };
  const f = fixture(t, {}, async () => { stop(); await Promise.allSettled([...pending]); }); f.bind();
  t.signal.addEventListener('abort', stop, { once: true });
  const run = i => {
    const completion = new Promise(resolve => {
    const child = spawn(process.execPath, [controller], { env: { ...process.env, CODEX_HOME: f.home },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 5000, killSignal: 'SIGKILL' });
    children.add(child);
    let error = null;
    let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', value => { error = value.code || value.message; });
    child.stdin.on('error', value => { error ||= value.code || value.message; });
    child.on('close', (code, signal) => { children.delete(child); resolve({ code, signal, error, stdout, stderr }); });
    child.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 'session-1', cwd: f.cwd,
      agent_id: `concurrent-${i}`, agent_type: 'worker', last_assistant_message: 'DO_NOT_LOG' }));
    }).finally(() => pending.delete(completion));
    pending.add(completion); return completion;
  };
  // Retain all 24 events while admitting four Node runtimes at once. Node's
  // native threads also consume the restricted verifier's 128 PID budget.
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!stopping && !t.signal.aborted && next < results.length) { const i = next++; results[i] = await run(i); }
  }));
  if (t.signal.aborted) return;
  for (const result of results) {
    const diagnostic = JSON.stringify({ code: result.code, signal: result.signal, error: result.error,
      stdout: result.stdout.slice(0, 1000), stderr: result.stderr.slice(0, 2000) });
    if (result.code !== 0 || result.signal || result.error) process.stderr.write(`Audit writer failed: ${diagnostic}\n`);
    assert.equal(result.code, 0, diagnostic); assert.equal(result.signal, null, diagnostic); assert.equal(result.error, null, diagnostic);
    assert.deepEqual(JSON.parse(result.stdout), {}, diagnostic);
  }
  const events = f.audit().filter(event => event.agent_id?.startsWith('concurrent-'));
  assert.equal(events.length, 24); assert.equal(new Set(events.map(event => event.agent_id)).size, 24);
});
