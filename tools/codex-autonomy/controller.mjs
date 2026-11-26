import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt']);
const STATUSES = new Set(['active', 'paused', 'cancelled', 'awaiting_approval', 'resource_limited', 'blocked', 'complete']);
const TASK_STATUSES = new Set(['pending', 'running', 'verified', 'failed', 'blocked']);
const HASH = /^[a-f0-9]{64}$/i, TOKEN = /^[a-f0-9-]{36}$/;
const INPUT_LIMIT_BYTES = 1024 * 1024; // One MiB of UTF-8 hook JSON; larger or incomplete requests must stop safely.
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const fail = code => { throw Object.assign(new Error(code), { policyCode: code }); };
const warning = code => ({ systemMessage: `Autonomy warning: ${code}. Stop is allowed; inspect the bound state or explicitly resume after resolving the cause.` });
const stopRequest = code => ({ continue: false, stopReason: `Autonomy stopped this request: ${code}. Input or owner control could not be confirmed; resolve the cause before explicitly resuming.` });
const codeOf = error => error.policyCode || 'RUNTIME_ERROR';
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const homePath = home => path.resolve(home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));

// Refuse links in every component; never recurse through the workspace or follow a state-selected absolute path.
function secure(file, kind) {
  if (!path.isAbsolute(file)) fail('UNSAFE_PATH');
  let cursor = path.parse(file).root, stat;
  for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH');
    if (!same(cursor, file) && !stat.isDirectory()) fail('UNSAFE_PATH');
  }
  stat ||= fs.lstatSync(file);
  if ((kind === 'dir' && !stat.isDirectory()) || (kind === 'file' && !stat.isFile())) fail('UNSAFE_PATH');
  if (!same(fs.realpathSync.native(file), path.resolve(file))) fail('UNSAFE_PATH');
  return stat;
}
function relativeFile(root, relative) {
  if (!text(relative, 2048) || path.isAbsolute(relative)) fail('UNSAFE_PATH');
  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..' || /[:\0]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('UNSAFE_PATH');
  return path.join(root, ...parts);
}
function readBounded(file, max) {
  const before = secure(file, 'file');
  if (before.size > max) fail('FILE_TOO_LARGE');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) fail('FILE_TOO_LARGE');
    const buffer = Buffer.alloc(Math.min(max + 1, stat.size + 1)); let used = 0, count;
    while (used < buffer.length && (count = fs.readSync(fd, buffer, used, buffer.length - used, used))) used += count;
    const after = fs.fstatSync(fd), named = secure(file, 'file');
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || named.ino !== after.ino || named.dev !== after.dev) fail('FILE_CHANGED');
    if (used > max) fail('FILE_TOO_LARGE');
    return buffer.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
function json(file, max = 16384, absent = false) {
  let data;
  try { data = readBounded(file, max); } catch (error) { if (absent && error.code === 'ENOENT') return undefined; throw error; }
  try { return JSON.parse(data); } catch { fail('STATE_INVALID'); }
}
function ensureDir(file) {
  secure(path.dirname(file), 'dir');
  try { fs.mkdirSync(file, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  secure(file, 'dir');
}
function writeAtomic(file, value) {
  secure(path.dirname(file), 'dir');
  try { secure(file, 'file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(path.dirname(file), `.tmp-${randomUUID()}`);
  try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
function runtimeDirs(home) {
  secure(home, 'dir');
  const base = path.join(home, 'autonomy'), runs = path.join(base, 'runs');
  ensureDir(base); ensureDir(runs); ensureDir(path.join(runs, 'bindings')); ensureDir(path.join(runs, 'goals'));
  ensureDir(path.join(runs, 'controls')); return runs;
}
function runtime(home, action) {
  const runs = runtimeDirs(home);
  const lock = path.join(runs, '.lock'), deadline = Date.now() + 1000;
  for (;;) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // The owner may remove its lock after EEXIST. Only inspect this entry: do not traverse a disappearing directory.
      try { const stat = fs.lstatSync(lock); if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_PATH'); }
      catch (inspection) { if (inspection.code !== 'ENOENT') throw inspection; }
      if (Date.now() >= deadline) fail('CONTROLLER_BUSY');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try { return action(runs); } finally { secure(lock, 'dir'); fs.rmdirSync(lock); }
}
function audit(runs, input, now, reason, stateHash, details = {}) {
  const entry = { event: input.hook_event_name, time: new Date(now).toISOString(), session_id: input.session_id,
    reason_code: reason, ...(stateHash ? { state_hash: stateHash } : {}), ...details };
  if (input.hook_event_name === 'SubagentStop') {
    entry.end_state = 'stopped-reported';
    if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.length <= 65536 && Buffer.byteLength(input.last_assistant_message) <= 65536)
      entry.last_assistant_message_sha256 = hash(input.last_assistant_message);
  }
  for (const key of ['turn_id', 'agent_id', 'agent_type']) if (text(input[key])) entry[key] = input[key];
  const file = path.join(runs, 'events.jsonl'), previous = path.join(runs, 'events.previous.jsonl');
  let size = 0; try { size = secure(file, 'file').size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const line = Buffer.from(JSON.stringify(entry) + '\n');
  if (size + line.length > 262144) {
    try { secure(previous, 'file'); fs.unlinkSync(previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.renameSync(file, previous);
  }
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { let written = 0; while (written < line.length) written += fs.writeSync(fd, line, written, line.length - written); }
  finally { fs.closeSync(fd); }
}
const goalKey = (cwd, id) => hash(`${process.platform === 'win32' ? cwd.toLowerCase() : cwd}\0${id}`);
const bindingPath = (runs, session) => path.join(runs, 'bindings', `${hash(session)}.json`);
const ledgerPath = (runs, key) => path.join(runs, 'goals', `${key}.json`);
function binding(runs, session) {
  const value = json(bindingPath(runs, session), 16384, true);
  if (value === undefined) return null;
  if (!object(value) || value.version !== 1 || value.session !== session || !text(value.goalId) ||
    !text(value.cwd, 4096) || !path.isAbsolute(value.cwd) || value.goalKey !== goalKey(value.cwd, value.goalId) ||
    typeof value.active !== 'boolean' || typeof value.interrupted !== 'boolean' ||
    (value.acknowledgedControls !== undefined && (!Array.isArray(value.acknowledgedControls) || value.acknowledgedControls.length > 64 || !value.acknowledgedControls.every(id => typeof id === 'string' && TOKEN.test(id)))) ||
    (value.pendingToken !== null && (!TOKEN.test(value.pendingToken) || !['ACTIONABLE', 'EVIDENCE_REQUIRED'].includes(value.pendingCode)))) fail('METADATA_INVALID');
  relativeFile(value.cwd, value.state); value.acknowledgedControls ||= []; return value;
}
const controlDir = (runs, session) => path.join(runs, 'controls', hash(session));
function signals(runs, session) {
  const directory = controlDir(runs, session), values = []; let stream;
  try { secure(directory, 'dir'); } catch (error) { if (error.code === 'ENOENT') return values; throw error; }
  try {
    stream = fs.opendirSync(directory); let entry;
    while ((entry = stream.readSync())) {
      if (entry.name === 'overflow.json') { secure(path.join(directory, entry.name), 'file'); fail('CONTROL_CAPACITY'); }
      if (values.length >= 64 || !/^signal-(?:[0-5]\d|6[0-3])\.json$/.test(entry.name)) fail('METADATA_INVALID');
      const value = json(path.join(directory, entry.name), 1024);
      if (!object(value) || value.version !== 1 || !TOKEN.test(value.id) || !['Interrupt', 'UserPromptSubmit'].includes(value.event) ||
        !Number.isFinite(value.time) || (value.ownToken !== null && !TOKEN.test(value.ownToken))) fail('METADATA_INVALID');
      values.push({ ...value, file: entry.name });
    }
  } finally { stream?.closeSync(); }
  return values;
}
function recordControl(runs, input, now) {
  const directory = controlDir(runs, input.session_id); ensureDir(directory);
  try { secure(path.join(directory, 'overflow.json'), 'file'); fail('CONTROL_CAPACITY'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Reading another writer's signal or a changing binding must never prevent persistence of owner control.
  let bound; if (input.hook_event_name === 'UserPromptSubmit') try { bound = binding(runs, input.session_id); } catch {}
  const own = input.hook_event_name === 'UserPromptSubmit' && bound?.active && !bound.interrupted && bound.pendingToken && input.prompt === continuation(bound.pendingToken, bound.pendingCode);
  const value = { version: 1, id: randomUUID(), event: input.hook_event_name, time: now, ownToken: own ? bound.pendingToken : null };
  for (let slot = 0; slot < 64; slot++) {
    try { fs.writeFileSync(path.join(directory, `signal-${String(slot).padStart(2, '0')}.json`), JSON.stringify(value), { flag: 'wx', mode: 0o600 }); return value; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  try { fs.writeFileSync(path.join(directory, 'overflow.json'), '{}', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  fail('CONTROL_CAPACITY');
}
function applyControls(runs, session, bound) {
  const current = signals(runs, session); if (!bound) return;
  const acknowledged = new Set(bound.acknowledgedControls), pending = current.filter(signal => !acknowledged.has(signal.id));
  if (!pending.length) return;
  if (pending.length === 1 && pending[0].event === 'UserPromptSubmit' && bound.active && !bound.interrupted && bound.pendingToken && pending[0].ownToken === bound.pendingToken) {
    acknowledged.add(pending[0].id); bound.acknowledgedControls = current.filter(signal => acknowledged.has(signal.id)).map(signal => signal.id); bound.pendingToken = null;
  } else { bound.active = false; bound.interrupted ||= pending.some(signal => signal.event === 'Interrupt'); bound.pendingToken = null; }
  writeAtomic(bindingPath(runs, session), bound);
}
function ledger(runs, key, now) {
  const stored = json(ledgerPath(runs, key), 65536, true);
  const value = stored === undefined ? { startedAt: now, lastNow: now, continuations: 0, noProgress: 0, fingerprint: null } : stored;
  if (!object(value) || !Number.isFinite(value.startedAt) || !Number.isFinite(value.lastNow) || value.startedAt < 0 || value.lastNow < value.startedAt ||
    ![value.continuations, value.noProgress].every(n => Number.isSafeInteger(n) && n >= 0) || (value.fingerprint !== null && !HASH.test(value.fingerprint)) ||
    (value.seenVerified !== undefined && (!Array.isArray(value.seenVerified) || value.seenVerified.length > 512 || !value.seenVerified.every(token => typeof token === 'string' && HASH.test(token))))) fail('METADATA_INVALID');
  return value;
}
function stateAt(cwd, relative) {
  secure(cwd, 'dir'); const file = relativeFile(cwd, relative); let raw;
  try { raw = readBounded(file, 131072); } catch (error) { if (!error.policyCode) fail('STATE_INVALID'); throw error; }
  let state; try { state = JSON.parse(raw); } catch { fail('STATE_INVALID'); }
  if (!object(state) || state.version !== 1 || !object(state.goal) || !text(state.goal.id) || !text(state.goal.title, 1024) ||
    !Array.isArray(state.goal.acceptance) || !state.goal.acceptance.length || state.goal.acceptance.length > 32 || !state.goal.acceptance.every(s => text(s, 2048)) ||
    !STATUSES.has(state.status) || !Array.isArray(state.tasks) || !state.tasks.length || state.tasks.length > 64 ||
    typeof state.next_action !== 'string' || state.next_action.length > 4096) fail('STATE_INVALID');
  const ids = new Set(); let totalEvidence = 0;
  const validReference = reference => {
    if (!object(reference) || !HASH.test(reference.sha256)) fail('STATE_INVALID');
    relativeFile(cwd, reference.path);
  };
  for (const task of state.tasks) {
    if (!object(task) || !text(task.id) || ids.has(task.id) || !TASK_STATUSES.has(task.status) || typeof task.actionable !== 'boolean' ||
      !Array.isArray(task.depends_on) || task.depends_on.length > 64 || !task.depends_on.every(id => text(id)) ||
      !Array.isArray(task.evidence) || task.evidence.length > 8) fail('STATE_INVALID');
    ids.add(task.id); totalEvidence += task.evidence.length; task.evidence.forEach(validReference);
  }
  if (totalEvidence > 128 || state.tasks.some(task => task.depends_on.some(id => !ids.has(id) || id === task.id))) fail('STATE_INVALID');
  const limits = { maxContinuations: 3, maxNoProgress: 2, maxMinutes: 20 };
  if (state.limits !== undefined) {
    if (!object(state.limits)) fail('STATE_INVALID');
    for (const [key, cap] of Object.entries({ maxContinuations: 5, maxNoProgress: 2, maxMinutes: 30 })) if (state.limits[key] !== undefined) {
      const value = state.limits[key];
      if (!Number.isFinite(value) || value < 0 || (key !== 'maxMinutes' && !Number.isSafeInteger(value))) fail('STATE_INVALID');
      limits[key] = Math.min(value, cap);
    }
  }
  let bytes = 0;
  const matches = reference => {
    let data;
    try { data = readBounded(relativeFile(cwd, reference.path), 8 * 1024 * 1024); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    bytes += data.length; if (bytes > 32 * 1024 * 1024) fail('FILE_TOO_LARGE');
    return hash(data) === reference.sha256.toLowerCase();
  };
  if (state.source !== undefined) { validReference(state.source); if (!matches(state.source)) fail('SOURCE_STALE'); }
  const verified = new Set();
  for (const task of state.tasks) if (task.status === 'verified' && task.evidence.length && task.evidence.map(matches).every(Boolean)) verified.add(task.id);
  const progress = state.tasks.filter(task => verified.has(task.id)).map(task =>
    [task.id, task.status, task.evidence.map(e => [e.path, e.sha256.toLowerCase()]).sort()]).sort((a, b) => a[0].localeCompare(b[0]));
  return { state, limits, verified, fingerprint: hash(JSON.stringify(progress)), progressTokens: progress.map(value => hash(JSON.stringify(value))), stateHash: hash(raw) };
}
function continuation(token, code) {
  return `Autonomy continuation ${token} (${code}): Continue the explicitly bound, owner-authorized goal using its canonical state. Verify evidence and work on eligible unfinished tasks. Preserve user pauses, approvals, and resource limits; never rebind to reset a limit.`;
}
function stop(input, bound, runs, now) {
  if (!bound || !bound.active || bound.interrupted) return { output: {}, code: 'DISARMED' };
  if (!same(path.resolve(input.cwd), bound.cwd)) return { output: warning('CWD_MISMATCH'), code: 'CWD_MISMATCH' };
  if (input.permission_mode === 'plan') return { output: {}, code: 'PLAN_MODE' };
  const snapshot = stateAt(bound.cwd, bound.state), { state, verified, limits, fingerprint, progressTokens, stateHash } = snapshot;
  const result = (output, code) => ({ output, code, stateHash });
  if (state.goal.id !== bound.goalId) return result(warning('GOAL_CHANGED'), 'GOAL_CHANGED');
  if (state.status === 'complete' && verified.size === state.tasks.length) return result({}, 'COMPLETE');
  if (!['active', 'complete'].includes(state.status)) return result({}, `STATUS_${state.status.toUpperCase()}`);
  const actionable = state.tasks.filter(task => task.actionable && task.status !== 'blocked' && !verified.has(task.id) && task.depends_on.every(id => verified.has(id)));
  if (!actionable.length) { const code = state.status === 'complete' ? 'COMPLETE_UNVERIFIED' : 'NO_ACTIONABLE'; return result(warning(code), code); }
  const resources = ledger(runs, bound.goalKey, now); resources.lastNow = Math.max(now, resources.lastNow);
  const hardLimit = resources.lastNow - resources.startedAt >= limits.maxMinutes * 60000 ? 'TIME_LIMIT' : resources.continuations >= limits.maxContinuations ? 'CONTINUATION_LIMIT' : null;
  if (hardLimit) { writeAtomic(ledgerPath(runs, bound.goalKey), resources); return result(warning(hardLimit), hardLimit); }
  const seen = new Set(resources.seenVerified || []), newProgress = resources.seenVerified !== undefined && progressTokens.some(token => !seen.has(token));
  resources.noProgress = resources.fingerprint === null || newProgress ? 0 : resources.noProgress + 1;
  resources.seenVerified = [...new Set([...seen, ...progressTokens])]; if (resources.seenVerified.length > 512) fail('METADATA_INVALID');
  resources.fingerprint = fingerprint;
  const exhausted = resources.lastNow - resources.startedAt >= limits.maxMinutes * 60000 ? 'TIME_LIMIT' :
    resources.continuations >= limits.maxContinuations ? 'CONTINUATION_LIMIT' : resources.noProgress >= limits.maxNoProgress ? 'NO_PROGRESS_LIMIT' : null;
  if (exhausted) { writeAtomic(ledgerPath(runs, bound.goalKey), resources); return result(warning(exhausted), exhausted); }
  resources.continuations++; bound.pendingToken = randomUUID();
  bound.pendingCode = state.status === 'complete' || actionable.some(task => task.status === 'verified') ? 'EVIDENCE_REQUIRED' : 'ACTIONABLE';
  writeAtomic(ledgerPath(runs, bound.goalKey), resources); writeAtomic(bindingPath(runs, input.session_id), bound);
  return result({ decision: 'block', reason: continuation(bound.pendingToken, bound.pendingCode) }, bound.pendingCode);
}

export function handleEvent(input, { home, now = Date.now() } = {}) {
  let valid = false, controlRecorded = false;
  try {
    if (!object(input) || !EVENTS.has(input.hook_event_name) || !text(input.session_id) || !text(input.cwd, 4096) || !path.isAbsolute(input.cwd) || !Number.isFinite(now) || now < 0) fail('INPUT_INVALID');
    valid = true;
    const directories = runtimeDirs(homePath(home));
    const control = ['Interrupt', 'UserPromptSubmit'].includes(input.hook_event_name) ? recordControl(directories, input, now) : null;
    controlRecorded = Boolean(control);
    return runtime(homePath(home), runs => {
      const bound = binding(runs, input.session_id); applyControls(runs, input.session_id, bound);
      let output = {}, code = input.hook_event_name.toUpperCase(), stateHash, details = {};
      if (input.hook_event_name === 'Stop') {
        const result = stop(input, bound, runs, now); ({ output, code, stateHash } = result);
      } else if (control) {
        code = control.event === 'Interrupt' ? 'INTERRUPTED' : bound?.active && bound.acknowledgedControls.includes(control.id) ? 'OWN_CONTINUATION' : 'USER_DISARMED';
      } else if (input.hook_event_name === 'SessionStart') {
        const installed = path.join(homePath(home), 'autonomy', 'controller.mjs'), skill = path.join(homePath(home), 'skills', 'autonomous-development', 'SKILL.md');
        const context = `Session id: ${JSON.stringify(input.session_id)}. Read ${JSON.stringify(skill)} for owner-authorized development. Bind only after recognizing a development task or explicit resume: node ${JSON.stringify(installed)} bind --cwd <absolute-project-root> --state <relative-canonical-state> --session ${JSON.stringify(input.session_id)}. Ordinary user prompts disarm continuation. ${bound ? `Current binding: ${JSON.stringify(bound.state)}; ${bound.active && !bound.interrupted ? 'armed' : 'disarmed'}.` : 'No development goal is armed.'}`;
        output = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
      } else if (input.hook_event_name === 'SubagentStart') {
        output = { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'Follow the parent goal and owner controls. Report evidence; do not bind or resume autonomy independently.' } };
      } else if (input.hook_event_name === 'SubagentStop' && bound) {
        try {
          const snapshot = stateAt(bound.cwd, bound.state); stateHash = snapshot.stateHash;
          details = { task_count: snapshot.state.tasks.length, verified_task_count: snapshot.verified.size,
            evidence_count: snapshot.state.tasks.reduce((count, task) => count + task.evidence.length, 0) };
        } catch { code = 'SUBAGENT_STOP_STATE_UNAVAILABLE'; }
      }
      if (output.decision === 'block') { applyControls(runs, input.session_id, bound); if (!bound.active || bound.interrupted) { output = {}; code = 'CONTROL_DISARMED'; } }
      audit(runs, input, now, code, stateHash, details); return output;
    });
  } catch (error) {
    const stop = (!valid && input?.hook_event_name !== 'Interrupt') || (valid && input.hook_event_name === 'UserPromptSubmit' && !controlRecorded);
    return stop ? stopRequest(codeOf(error)) : warning(codeOf(error));
  }
}
function bind(args, home, now) {
  if (args.length !== 6) fail('INPUT_INVALID'); const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--cwd', '--state', '--session'].includes(args[i]) || options[args[i]] !== undefined) fail('INPUT_INVALID');
    options[args[i]] = args[i + 1];
  }
  const cwd = options['--cwd'], statePath = options['--state'], session = options['--session'];
  if (!text(cwd, 4096) || !path.isAbsolute(cwd) || !text(session)) fail('INPUT_INVALID');
  // Capture controls before state IO or the shared lock: a later owner signal cannot be acknowledged by this bind.
  const directories = runtimeDirs(home), acknowledged = signals(directories, session).map(signal => signal.id);
  const root = path.resolve(cwd), { state, stateHash } = stateAt(root, statePath), key = goalKey(root, state.goal.id);
  return runtime(home, runs => {
    const resources = ledger(runs, key, now); writeAtomic(ledgerPath(runs, key), resources);
    writeAtomic(bindingPath(runs, session), { version: 1, session, cwd: root, state: statePath, goalId: state.goal.id,
      goalKey: key, active: true, interrupted: false, pendingToken: null, acknowledgedControls: acknowledged });
    for (const signal of signals(runs, session)) if (acknowledged.includes(signal.id)) fs.unlinkSync(path.join(controlDir(runs, session), signal.file));
    audit(runs, { hook_event_name: 'Bind', session_id: session }, now, 'BOUND', stateHash);
    return { bound: true, session_id: session, goal_id: state.goal.id, cwd: root, state: statePath };
  });
}
async function stdin() {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { process.stdin.destroy(); reject(Object.assign(new Error(), { policyCode: 'INPUT_TIMEOUT' })); }, 1500);
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > INPUT_LIMIT_BYTES) { clearTimeout(timer); process.stdin.destroy(); reject(Object.assign(new Error(), { policyCode: 'INPUT_TOO_LARGE' })); }
      else chunks.push(chunk);
    });
    process.stdin.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { reject(Object.assign(new Error(), { policyCode: 'INPUT_INVALID' })); } });
    process.stdin.on('error', error => { clearTimeout(timer); reject(error); });
  }).catch(error => { throw Object.assign(error, { inputFailure: true }); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let output;
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'bind') output = bind(args.slice(1), homePath(), Date.now());
    else {
      if (args.length && !(args.length === 2 && args[0] === '--revision' && HASH.test(args[1]))) fail('INPUT_INVALID');
      if (args.length && hash(readBounded(fileURLToPath(import.meta.url), 131072)) !== args[1].toLowerCase()) fail('REVISION_MISMATCH');
      output = handleEvent(await stdin());
    }
  } catch (error) { output = error.inputFailure ? stopRequest(codeOf(error)) : warning(codeOf(error)); if (process.argv[2] === 'bind') process.exitCode = 1; }
  process.stdout.write(JSON.stringify(output) + '\n');
}
