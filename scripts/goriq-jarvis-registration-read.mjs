// The native adapter owns original acquisition. SQLite opens only work/, never raw/.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exactIdentifiers } from './goriq-g1-backup-inventory.mjs';

const GOAL = 'goal-fcc81c97e09153f7', JOB = 'rotation-recovery-37';
const MAX_JSON = 1024 * 1024;
const REQUIREMENT_STATES = new Set(['IDEA', 'PROPOSED', 'ACCEPTED_REQUIREMENT', 'SPEC_SYNCED', 'SUPERSEDED', 'WITHDRAWN']);
const PHASES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING', 'RECOVERING', 'HUMAN_GATE', 'BLOCKED', 'COMPLETED', 'FAILED']);
const HASH = /^[a-f0-9]{64}$/;
const mentionsJarvis = text => /jarvis|ジャービス/iu.test(text);
function requireCondition(value) { if (!value) throw Error('COPIED_QUERY_INVALID'); }
function emptySummary() {
  return {
    version: 1, mode: 'FIXED_JARVIS_REGISTRATION_METADATA', status: 'INCOMPLETE', failureCode: 'COPIED_QUERY_INVALID',
    readOnly: true, preserved: false, preservationMode: null, queryVerified: false,
    currentGoalPresent: null, currentGoalId: null, currentGoalMentionsJarvis: null,
    ownerRequirementCount: null, ownerRequirementsForOriginalGoal: null, ownerRequirementsMentioningJarvis: null, ownerRequirementsWithoutGoal: null,
    workRunCount: null, workRunsForOriginalGoal: null,
    detailsOmitted: true, authorityComplete: false, originalGoalRecovered: false, g1: 'HOLD',
  };
}
function copiedFile(root, name, limit) {
  const path = join(root, 'work', name), st = lstatSync(path);
  requireCondition(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size <= limit && realpathSync(path) === path);
  return st;
}
function singleton(active, kind, field, maximum) {
  const matches = active.filter(value => value?.kind === kind);
  requireCondition(matches.length <= 1);
  if (matches.length === 0) return [];
  requireCondition(matches[0].version === 1 && Array.isArray(matches[0][field]) && matches[0][field].length <= maximum);
  return matches[0][field];
}
function rejectDuplicateKeys(raw, deadline) {
  // JSON.parse has already checked grammar. Tokenize strings as whole values so
  // braces/key-like text inside statements never affect object-key scopes.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g, frames = [];
  for (let match = tokens.exec(raw); match; match = tokens.exec(raw)) {
    requireCondition(Date.now() <= deadline);
    const token = match[0], frame = frames.at(-1);
    if (token === '{') frames.push({ object: true, key: true, seen: new Set() });
    else if (token === '[') frames.push({ object: false });
    else if (token === '}' || token === ']') frames.pop();
    else if (token === ',' && frame?.object) frame.key = true;
    else if (token[0] === '"' && frame?.object && frame.key) {
      const key = JSON.parse(token); requireCondition(!frame.seen.has(key)); frame.seen.add(key); frame.key = false;
    }
  }
}
function validateReceipts(records) {
  // Dependency-free parity with ownerRequirementRecords: importing the app on
  // installed Node22 would load unsupported TS/application initialization.
  const ids = new Set();
  for (const record of records) {
    requireCondition(record && typeof record.id === 'string' && /^owner-intake-[a-f0-9]{32}$/.test(record.id) && !ids.has(record.id)); ids.add(record.id);
    requireCondition(record.goalId === null || typeof record.goalId === 'string' && record.goalId.length > 0 && record.goalId.length <= 160);
    requireCondition(REQUIREMENT_STATES.has(record.state) && typeof record.statement === 'string' && Buffer.byteLength(record.statement) > 0 && Buffer.byteLength(record.statement) <= 16000);
    requireCondition(typeof record.requestHash === 'string' && HASH.test(record.requestHash) && typeof record.keyDigest === 'string' && HASH.test(record.keyDigest));
    requireCondition(record.source?.boundary === 'broker_owner_auth' && typeof record.source.textSha256 === 'string' && HASH.test(record.source.textSha256));
    requireCondition(record.source.textSha256 === createHash('sha256').update(record.statement).digest('hex'));
    requireCondition(typeof record.source.recordedAt === 'string' && Number.isFinite(Date.parse(record.source.recordedAt)) && record.reviewRequired === true);
    for (const field of ['canonicalIds', 'matches', 'history', 'supersedes', 'supersededBy']) requireCondition(Array.isArray(record[field]));
    requireCondition(record.history.length > 0 && record.history.at(-1)?.state === record.state);
    requireCondition(record.history.every(entry => REQUIREMENT_STATES.has(entry?.state) && Number.isFinite(Date.parse(entry.at)) && typeof entry.reason === 'string'));
    requireCondition((record.state === 'SUPERSEDED') === (record.supersededBy.length > 0));
    if (record.state === 'WITHDRAWN') requireCondition(record.history.some(entry => entry.reason === 'owner_withdrawal_pending_canonical_sync'));
    if (record.publication) {
      const value = record.publication;
      requireCondition(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['baseSha', 'artifactHash', 'reviewHash', 'branch', 'headSha', 'prNumber'].includes(key)));
      requireCondition(typeof value.baseSha === 'string' && /^[a-f0-9]{40}$/.test(value.baseSha) && typeof value.artifactHash === 'string' && HASH.test(value.artifactHash) && typeof value.reviewHash === 'string' && HASH.test(value.reviewHash));
      requireCondition(value.branch === 'codex/spec-sync/' + record.id && (value.headSha === undefined || typeof value.headSha === 'string' && /^[a-f0-9]{40}$/.test(value.headSha)));
      requireCondition(value.prNumber === undefined || !!value.headSha && Number.isSafeInteger(value.prNumber) && value.prNumber > 0);
    }
  }
  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of records) {
    if (record.conversation) {
      const value = record.conversation;
      requireCondition(typeof value.inputHash === 'string' && HASH.test(value.inputHash) && typeof value.contextHash === 'string' && HASH.test(value.contextHash) && Array.isArray(value.referenceIds));
      requireCondition(value.referenceIds.every(id => byId.has(id) && byId.get(id).goalId === record.goalId));
    }
    for (const id of record.supersedes) requireCondition(byId.get(id)?.supersededBy.includes(record.id) && byId.get(id).goalId === record.goalId);
    for (const id of record.supersededBy) requireCondition(byId.get(id)?.supersedes.includes(record.id));
  }
  const visiting = new Set(), done = new Set();
  const visit = id => {
    requireCondition(!visiting.has(id)); if (done.has(id)) return;
    visiting.add(id); for (const next of byId.get(id).supersededBy) visit(next); visiting.delete(id); done.add(id);
  };
  for (const id of byId.keys()) visit(id);
}
function validateWorkRun(run, goalIds, runIds) {
  requireCondition(run && typeof run.goalId === 'string' && run.goalId.length > 0 && run.goalId.length <= 160 && !goalIds.has(run.goalId) && PHASES.has(run.phase));
  requireCondition(typeof run.runId === 'string' && run.runId.length > 0 && !runIds.has(run.runId));
  for (const key of ['currentWork', 'nextAction']) requireCondition(run[key] === null || typeof run[key] === 'string');
  for (const key of ['completedJobs', 'recoveryCount']) requireCondition(Number.isSafeInteger(run[key]) && run[key] >= 0);
  requireCondition(run.totalJobs === null || Number.isSafeInteger(run.totalJobs) && run.totalJobs >= 0);
  for (const key of ['blockers', 'evidenceRefs']) requireCondition(Array.isArray(run[key]) && run[key].every(value => typeof value === 'string'));
  for (const key of ['createdAt', 'updatedAt']) requireCondition(typeof run[key] === 'string' && Number.isFinite(Date.parse(run[key])));
  if (run.continuationWait !== undefined) {
    const value = run.continuationWait;
    requireCondition(value && !Array.isArray(value) && typeof value.retryAt === 'string' && Number.isFinite(Date.parse(value.retryAt)) && Number.isInteger(value.slices) && value.slices >= 1 && value.slices <= 20);
  }
  if (run.resourceWait !== undefined) {
    const value = run.resourceWait;
    requireCondition(value && !Array.isArray(value) && ['firstObservedAt', 'retryAt', 'deadline'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key]))));
    requireCondition(Number.isInteger(value.checks) && value.checks >= 1 && value.checks <= 20 && typeof value.reason === 'string' && value.reason.trim().length > 0 && value.reason.length <= 200);
    requireCondition(Date.parse(value.deadline) - Date.parse(value.firstObservedAt) === 1800000 && Date.parse(value.retryAt) >= Date.parse(value.firstObservedAt) && Date.parse(value.retryAt) <= Date.parse(value.deadline));
  }
  goalIds.add(run.goalId); runIds.add(run.runId);
}

export function inspectJarvisWorkingBundle(root) {
  const summary = emptySummary(); let db;
  try {
    requireCondition(resolve(root) === root && realpathSync(root) === root);
    const directory = join(root, 'work'), st = lstatSync(directory);
    requireCondition(st.isDirectory() && !st.isSymbolicLink() && realpathSync(directory) === directory);
    requireCondition(copiedFile(root, 'compass.sqlite', 64 * 1024 * 1024).size > 0);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        if (suffix === '-journal') { lstatSync(join(directory, 'compass.sqlite-journal')); throw Error('COPIED_QUERY_INVALID'); }
        copiedFile(root, 'compass.sqlite' + suffix, suffix === '-shm' ? 4 * 1024 * 1024 : 64 * 1024 * 1024);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const deadline = Date.now() + 30000;
    db = new DatabaseSync(join(directory, 'compass.sqlite'), { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF; BEGIN');
    requireCondition(db.prepare('PRAGMA query_only').get()?.query_only === 1);
    requireCondition(db.prepare('PRAGMA quick_check(1)').get()?.quick_check === 'ok');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goal','state')").all().map(row => row.name));
    requireCondition(tables.has('goal') && tables.has('state'));
    const sizes = db.prepare("SELECT length(CAST(active AS BLOB)) AS n FROM state WHERE project_id='default' LIMIT 2").all();
    requireCondition(sizes.length === 1 && Number.isSafeInteger(sizes[0].n) && sizes[0].n > 0 && sizes[0].n <= MAX_JSON);
    const raw = db.prepare("SELECT active FROM state WHERE project_id='default'").get().active;
    requireCondition(typeof raw === 'string' && Buffer.byteLength(raw) <= MAX_JSON);
    exactIdentifiers(raw, GOAL, JOB, deadline);
    rejectDuplicateKeys(raw, deadline);
    const active = JSON.parse(raw); requireCondition(Array.isArray(active));
    const goalSizes = db.prepare('SELECT coalesce(length(CAST(id AS BLOB)),0)+coalesce(length(CAST(title AS BLOB)),0)+coalesce(length(CAST(description AS BLOB)),0) AS n FROM goal LIMIT 2').all();
    requireCondition(goalSizes.length <= 1 && goalSizes.every(row => Number.isSafeInteger(row.n) && row.n <= MAX_JSON));
    const goalRows = db.prepare('SELECT id,title,description FROM goal LIMIT 2').all();
    requireCondition(goalRows.length === goalSizes.length && goalRows.length <= 1);
    const goal = goalRows[0];
    if (goal) requireCondition(goal.id === 1 && typeof goal.title === 'string' && typeof goal.description === 'string');
    const records = singleton(active, 'jarvis-owner-requirements', 'records', 500); validateReceipts(records);
    const runs = singleton(active, 'jarvis-work-runs', 'runs', 2000), goalIds = new Set(), runIds = new Set();
    for (const run of runs) validateWorkRun(run, goalIds, runIds);
    requireCondition(Date.now() <= deadline);
    Object.assign(summary, {
      status: 'READ', failureCode: 'NONE', queryVerified: true,
      currentGoalPresent: !!goal,
      currentGoalId: goal ? 'goal-' + createHash('sha256').update(JSON.stringify({ title: goal.title, description: goal.description })).digest('hex').slice(0, 16) : null,
      currentGoalMentionsJarvis: goal ? mentionsJarvis(goal.title + '\n' + goal.description) : null,
      ownerRequirementCount: records.length, ownerRequirementsForOriginalGoal: records.filter(record => record.goalId === GOAL).length,
      ownerRequirementsMentioningJarvis: records.filter(record => mentionsJarvis(record.statement)).length,
      ownerRequirementsWithoutGoal: records.filter(record => record.goalId === null).length,
      workRunCount: runs.length, workRunsForOriginalGoal: runs.filter(run => run.goalId === GOAL).length,
    });
  } catch { return emptySummary(); }
  finally { try { db?.exec('ROLLBACK'); } catch { /* disposable connection only */ } try { db?.close(); } catch { /* no original handle */ } }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result = emptySummary();
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    requireCondition(process.platform === 'win32' && process.argv.length === 3 && (major >= 24 || major === 23 && minor >= 2 || major === 22 && minor >= 12));
    result = inspectJarvisWorkingBundle(process.argv[2]);
    const output = join(process.argv[2], 'interpretation.json'), st = lstatSync(output);
    requireCondition(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size === 0 && realpathSync(output) === output);
    writeFileSync(output, JSON.stringify({ report: result, runtimeVersion: process.version }), { flag: 'r+' });
  } catch { result = emptySummary(); }
  process.stdout.write(JSON.stringify(result) + '\n');
}
