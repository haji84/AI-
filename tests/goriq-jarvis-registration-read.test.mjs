import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ownerRequirementRecords } from '../src/orchestrator/owner-requirement-intake.ts';
import { createQueuedWorkRun, assertGoalContinuation } from '../src/orchestrator/work-run-state.ts';
import { assertResourceWait } from '../src/orchestrator/development-resource-wait.ts';

const modulePath = '../scripts/goriq-jarvis-registration-read.mjs';
const reader = existsSync(new URL(modulePath, import.meta.url)) ? await import(modulePath) : {};
const originalGoal = 'goal-fcc81c97e09153f7';
const fixtureGoal = 'goal-0af48e9d681db91a';
const title = 'JARVIS registry fixture', description = 'PRIVATE_GOAL_CRITERIA';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const receipt = (digit, goalId, statement) => ({
  id: 'owner-intake-' + digit.repeat(32), goalId, state: 'ACCEPTED_REQUIREMENT', statement,
  requestHash: 'a'.repeat(64), keyDigest: digit.repeat(64),
  source: { boundary: 'broker_owner_auth', textSha256: createHash('sha256').update(statement).digest('hex'), recordedAt: '2026-11-03T07:16:13Z' },
  canonicalIds: [], matches: [], reviewRequired: true, supersedes: [], supersededBy: [],
  history: [{ state: 'ACCEPTED_REQUIREMENT', at: '2026-11-03T07:16:13Z', reason: 'PRIVATE_ACCEPTANCE' }],
});
function registrations() {
  const active = [{ kind: 'jarvis-owner-requirements', version: 1, records: [
    receipt('1', originalGoal, 'PRIVATE_RECEIPT_ONE ジャービスを完成させて'),
    receipt('2', null, 'PRIVATE_RECEIPT_TWO another requirement'),
    receipt('3', 'goal-1111111111111111', 'JARVIS PRIVATE_RECEIPT_THREE'),
  ] }, { kind: 'jarvis-work-runs', version: 1, runs: [
    { ...createQueuedWorkRun(originalGoal, '2026-11-03T07:16:13Z'), phase: 'BLOCKED' },
    { ...createQueuedWorkRun(fixtureGoal, '2026-11-03T07:16:13Z'), phase: 'PLANNING' },
  ] }];
  assert.equal(ownerRequirementRecords(active).length, 3);
  return active;
}
function fixture(t, { active = registrations(), goal = true, wal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-registration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['source', 'raw', 'work']) mkdirSync(join(root, dir));
  const path = join(root, 'source', 'compass.sqlite'), db = new DatabaseSync(path);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  db.exec('CREATE TABLE goal(id INTEGER,title TEXT,description TEXT); CREATE TABLE state(project_id TEXT,active TEXT)');
  if (goal) db.prepare('INSERT INTO goal VALUES (1,?,?)').run(title, description);
  db.prepare('INSERT INTO state VALUES (?,?)').run('default', JSON.stringify(active));
  for (const suffix of ['', '-wal']) {
    if (existsSync(path + suffix)) for (const dir of ['raw', 'work']) copyFileSync(path + suffix, join(root, dir, 'compass.sqlite' + suffix));
  }
  if (wal) t.after(() => db.close()); else db.close();
  const sourcePaths = ['', '-wal', '-shm'].filter(suffix => existsSync(path + suffix)).map(suffix => path + suffix);
  const rawPaths = ['', '-wal'].filter(suffix => existsSync(join(root, 'raw', 'compass.sqlite' + suffix))).map(suffix => join(root, 'raw', 'compass.sqlite' + suffix));
  return { root, sourcePaths, rawPaths, query: () => reader.inspectJarvisWorkingBundle?.(root) ?? { status: 'IMPLEMENTATION_MISSING' } };
}
function incomplete(result) {
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.queryVerified, false);
  for (const key of ['currentGoalId', 'ownerRequirementCount', 'ownerRequirementsForOriginalGoal', 'ownerRequirementsMentioningJarvis', 'ownerRequirementsWithoutGoal', 'workRunCount', 'workRunsForOriginalGoal']) assert.equal(result[key], null, key);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|jarvis-registration-/);
}

test('copied JARVIS metadata counts all target, other-Goal and unbound receipts without exposing statements', t => {
  const f = fixture(t), before = [...f.sourcePaths, ...f.rawPaths].map(digest);
  const r = f.query();
  assert.equal(r.status, 'READ'); assert.equal(r.queryVerified, true); assert.equal(r.readOnly, true);
  assert.equal(r.currentGoalPresent, true); assert.equal(r.currentGoalId, fixtureGoal); assert.equal(r.currentGoalMentionsJarvis, true);
  assert.equal(r.ownerRequirementCount, 3); assert.equal(r.ownerRequirementsForOriginalGoal, 1);
  assert.equal(r.ownerRequirementsMentioningJarvis, 2); assert.equal(r.ownerRequirementsWithoutGoal, 1);
  assert.equal(r.workRunCount, 2); assert.equal(r.workRunsForOriginalGoal, 1);
  assert.equal(r.originalGoalRecovered, false); assert.equal(r.authorityComplete, false); assert.equal(r.g1, 'HOLD');
  assert.deepEqual([...f.sourcePaths, ...f.rawPaths].map(digest), before);
  for (const secret of [title, description, 'PRIVATE', f.root, 'owner-intake-', originalGoal]) assert.ok(!JSON.stringify(r).includes(secret), secret);
});
test('unbound and historical registrations are visible even when no current Goal is stored', t => {
  const r = fixture(t, { goal: false }).query();
  assert.equal(r.status, 'READ'); assert.equal(r.currentGoalPresent, false); assert.equal(r.currentGoalId, null);
  assert.equal(r.currentGoalMentionsJarvis, null); assert.equal(r.ownerRequirementCount, 3); assert.equal(r.ownerRequirementsWithoutGoal, 1);
});
test('verified empty envelopes have zero counts and never imply original Goal recovery', t => {
  const r = fixture(t, { goal: false, active: [] }).query();
  assert.equal(r.status, 'READ'); assert.equal(r.ownerRequirementCount, 0); assert.equal(r.workRunCount, 0);
  assert.equal(r.ownerRequirementsForOriginalGoal, 0); assert.equal(r.originalGoalRecovered, false);
});
test('committed live WAL receipts are queried from work without changing original or frozen bytes', t => {
  const f = fixture(t, { wal: true }), paths = [...f.sourcePaths, ...f.rawPaths], before = paths.map(digest);
  assert.equal(f.query().ownerRequirementCount, 3); assert.deepEqual(paths.map(digest), before);
});
for (const [name, mutate] of [
  ['duplicate requirement envelopes', a => a.push(a[0])],
  ['unknown requirement envelope version', a => { a[0].version = 2; }],
  ['duplicate requirement IDs', a => a[0].records.push(a[0].records[0])],
  ['invalid receipt state', a => { a[0].records[0].state = 'PRIVATE_UNKNOWN'; }],
  ['invalid receipt identity', a => { a[0].records[0].id = 'PRIVATE_TOKEN'; }],
  ['non-string receipt text', a => { a[0].records[0].statement = { secret: 'PRIVATE' }; }],
  ['invalid receipt Goal linkage', a => { a[0].records[0].goalId = 123; }],
  ['invalid receipt source boundary', a => { a[0].records[0].source.boundary = 'model_asserted'; }],
  ['mismatched receipt text digest', a => { a[0].records[0].source.textSha256 = 'b'.repeat(64); }],
  ['array-coerced receipt identity', a => { a[0].records[0].id = [a[0].records[0].id]; }],
  ['missing receipt arrays', a => { delete a[0].records[0].canonicalIds; }],
  ['empty receipt lifecycle', a => { a[0].records[0].history = []; }],
  ['mismatched current lifecycle state', a => { a[0].records[0].history[0].state = 'PROPOSED'; }],
  ['invalid lifecycle timestamp', a => { a[0].records[0].history[0].at = 'PRIVATE_INVALID'; }],
  ['missing superseded successor', a => { a[0].records[0].state = 'SUPERSEDED'; a[0].records[0].history[0].state = 'SUPERSEDED'; }],
  ['withdrawal without owner provenance', a => { a[0].records[0].state = 'WITHDRAWN'; a[0].records[0].history[0].state = 'WITHDRAWN'; }],
  ['cross-Goal supersession links', a => { const [old, next] = a[0].records; old.state = 'SUPERSEDED'; old.history[0].state = 'SUPERSEDED'; old.supersededBy = [next.id]; next.supersedes = [old.id]; }],
  ['cyclic receipt history', a => { const [left, right] = a[0].records; right.goalId = left.goalId; for (const [row, other] of [[left, right], [right, left]]) { row.state = 'SUPERSEDED'; row.history[0].state = 'SUPERSEDED'; row.supersedes = [other.id]; row.supersededBy = [other.id]; } }],
  ['invalid receipt publication branch', a => { a[0].records[0].publication = { baseSha: 'a'.repeat(40), artifactHash: 'a'.repeat(64), reviewHash: 'b'.repeat(64), branch: 'PRIVATE_BRANCH' }; }],
  ['missing saved conversation reference', a => { a[0].records[0].conversation = { inputHash: 'a'.repeat(64), contextHash: 'b'.repeat(64), referenceIds: ['owner-intake-' + 'f'.repeat(32)] }; }],
  ['oversized receipt text', a => { a[0].records[0].statement = 'x'.repeat(16001); }],
  ['receipt record limit', a => { a[0].records = Array.from({ length: 501 }, (_, i) => ({ ...a[0].records[0], id: 'owner-intake-' + i.toString(16).padStart(32, '0') })); }],
  ['duplicate WorkRun envelopes', a => a.push(a[1])],
  ['duplicate WorkRun Goal IDs', a => a[1].runs.push(a[1].runs[0])],
  ['unsupported WorkRun phase', a => { a[1].runs[0].phase = 'PRIVATE_UNKNOWN'; }],
  ['development-only WorkRun phase', a => { a[1].runs[0].phase = 'IMPLEMENTING'; }],
  ['missing WorkRun identity', a => { delete a[1].runs[0].runId; }],
  ['duplicate WorkRun identities across Goals', a => { a[1].runs[1].runId = a[1].runs[0].runId; }],
  ['negative WorkRun progress', a => { a[1].runs[0].completedJobs = -1; }],
  ['non-numeric WorkRun totals', a => { a[1].runs[0].totalJobs = '2'; }],
  ['invalid WorkRun blockers', a => { a[1].runs[0].blockers = 'PRIVATE'; }],
  ['missing WorkRun evidence', a => { delete a[1].runs[0].evidenceRefs; }],
  ['invalid WorkRun timestamp', a => { a[1].runs[0].createdAt = 'PRIVATE_INVALID'; }],
  ['invalid WorkRun current text', a => { a[1].runs[0].currentWork = { private: 'PRIVATE' }; }],
  ['invalid WorkRun next action', a => { a[1].runs[0].nextAction = { private: 'PRIVATE' }; }],
  ['invalid WorkRun continuation', a => { a[1].runs[0].continuationWait = { retryAt: 'PRIVATE_INVALID', slices: 21 }; }],
  ['invalid WorkRun resource checkpoint', a => { a[1].runs[0].resourceWait = { firstObservedAt: '2026-11-03T07:16:13Z', retryAt: '2026-11-03T07:16:18Z', deadline: '2026-11-03T07:46:13Z', checks: 21, reason: 'PRIVATE_RESOURCE' }; }],
  ['oversized active JSON', a => a.push({ kind: 'other', payload: 'x'.repeat(1024 * 1024) })],
  ['deep unrelated active JSON', a => { let p = {}; a.push(p); for (let i = 0; i < 34; i++) { p.child = {}; p = p.child; } }],
]) test(name + ' is unknown/incomplete rather than zero registrations', t => {
  const active = registrations(); mutate(active); incomplete(fixture(t, { active }).query());
});
test('runtime-valid supersession and publication history remain observable without exposing the records', t => {
  const active = registrations(), [old, next] = active[0].records;
  next.goalId = old.goalId; old.state = 'SUPERSEDED'; old.history.push({ state: 'SUPERSEDED', at: '2026-11-03T08:00:00Z', reason: 'PRIVATE_CORRECTION' });
  old.supersededBy = [next.id]; next.supersedes = [old.id];
  next.publication = { baseSha: 'a'.repeat(40), artifactHash: 'b'.repeat(64), reviewHash: 'c'.repeat(64), branch: 'codex/spec-sync/' + next.id, headSha: 'b'.repeat(40), prNumber: 1 };
  next.conversation = { inputHash: 'c'.repeat(64), contextHash: 'd'.repeat(64), referenceIds: [old.id] };
  assert.equal(ownerRequirementRecords(active).length, 3);
  const r = fixture(t, { active }).query(); assert.equal(r.status, 'READ'); assert.equal(r.ownerRequirementCount, 3); assert.equal(r.ownerRequirementsForOriginalGoal, 2);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|owner-intake-|codex\/spec-sync/);
});
test('writer-produced WorkRuns with validated resource and continuation checkpoints remain counted', t => {
  const active = registrations(), [resource, continuation] = active[1].runs;
  resource.resourceWait = { firstObservedAt: '2026-11-03T07:16:13Z', retryAt: '2026-11-03T07:16:18Z', deadline: '2026-11-03T07:46:13Z', checks: 1, reason: 'PRIVATE_RESOURCE' };
  continuation.continuationWait = { retryAt: '2026-11-03T07:16:18Z', slices: 1 };
  assertResourceWait(resource.resourceWait); assertGoalContinuation(continuation.continuationWait);
  const r = fixture(t, { active }).query(); assert.equal(r.status, 'READ'); assert.equal(r.workRunCount, 2); assert.equal(r.workRunsForOriginalGoal, 1);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_RESOURCE|retryAt|deadline|evidenceRefs/);
});
test('250 complete stored receipts within the shared structure budget are counted without eviction', t => {
  const records = Array.from({ length: 250 }, (_, i) => ({ ...receipt('1', null, 'PRIVATE'), id: 'owner-intake-' + i.toString(16).padStart(32, '0') }));
  const r = fixture(t, { active: [{ kind: 'jarvis-owner-requirements', version: 1, records }] }).query();
  assert.equal(r.status, 'READ'); assert.equal(r.ownerRequirementCount, 250); assert.equal(r.ownerRequirementsWithoutGoal, 250);
});
test('500 complete receipts beyond the existing 10000-node budget stay unknown rather than dropping history', t => {
  const records = Array.from({ length: 500 }, (_, i) => ({ ...receipt('1', null, 'PRIVATE'), id: 'owner-intake-' + i.toString(16).padStart(32, '0') }));
  incomplete(fixture(t, { active: [{ kind: 'jarvis-owner-requirements', version: 1, records }] }).query());
});
test('a malformed database cannot become a successful empty registry', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'work', 'compass.sqlite'), 'PRIVATE_NOT_SQLITE'); incomplete(f.query());
});
test('a journal and a hard-linked working database are refused without opening source SQLite', t => {
  const f = fixture(t), before = f.rawPaths.map(digest);
  writeFileSync(join(f.root, 'work', 'compass.sqlite-journal'), 'PRIVATE'); incomplete(f.query());
  rmSync(join(f.root, 'work', 'compass.sqlite-journal')); linkSync(join(f.root, 'work', 'compass.sqlite'), join(f.root, 'alias.sqlite')); incomplete(f.query());
  assert.deepEqual(f.rawPaths.map(digest), before);
});
test('working-directory symlinks cannot redirect a registry query into source storage', t => {
  const f = fixture(t), before = f.sourcePaths.map(digest);
  rmSync(join(f.root, 'work'), { recursive: true }); symlinkSync(join(f.root, 'source'), join(f.root, 'work'), 'junction');
  incomplete(f.query()); assert.deepEqual(f.sourcePaths.map(digest), before);
});
test('ambiguous default-state rows cannot hide or combine stored registrations', t => {
  const f = fixture(t), db = new DatabaseSync(join(f.root, 'work', 'compass.sqlite'));
  db.prepare('INSERT INTO state VALUES (?,?)').run('default', '[]'); db.close(); incomplete(f.query());
});
for (const [name, sql] of [
  ['noncanonical Goal identity', 'UPDATE goal SET id=2'],
  ['extra singleton Goal row', "INSERT INTO goal VALUES (2,'PRIVATE_OTHER','PRIVATE_OTHER')"],
  ['null Goal identity', 'UPDATE goal SET id=NULL'],
]) test(name + ' cannot be reported as a verified missing current Goal', t => {
  const f = fixture(t), db = new DatabaseSync(join(f.root, 'work', 'compass.sqlite'));
  db.exec(sql); db.close(); incomplete(f.query());
});
test('duplicate active JSON keys cannot silently select one registration envelope interpretation', t => {
  const f = fixture(t), db = new DatabaseSync(join(f.root, 'work', 'compass.sqlite'));
  const active = JSON.stringify(registrations()).replace('"kind":"jarvis-owner-requirements"', '"kind":"other","kind":"jarvis-owner-requirements"');
  db.prepare('UPDATE state SET active=?').run(active); db.close(); incomplete(f.query());
});
test('escaped duplicate active keys are ambiguous even though JSON.parse chooses the final one', t => {
  const f = fixture(t), db = new DatabaseSync(join(f.root, 'work', 'compass.sqlite'));
  const escapedKey = '"' + String.fromCharCode(92) + 'u006bind"';
  const active = JSON.stringify(registrations()).replace('"kind"', '"kind":"other",' + escapedKey);
  db.prepare('UPDATE state SET active=?').run(active); db.close(); incomplete(f.query());
});
test('formatted JSON, unambiguous escaped keys and key-like statement text remain readable', t => {
  const active = registrations(); active[0].records[0].statement = 'PRIVATE_VALUE "kind":"first","kind":"second"';
  active[0].records[0].source.textSha256 = createHash('sha256').update(active[0].records[0].statement).digest('hex');
  assert.equal(ownerRequirementRecords(active).length, 3);
  const f = fixture(t, { active }), db = new DatabaseSync(join(f.root, 'work', 'compass.sqlite'));
  const escapedKey = '"' + String.fromCharCode(92) + 'u006bind"';
  db.prepare('UPDATE state SET active=?').run(JSON.stringify(active, null, 2).replace('"kind"', escapedKey)); db.close();
  const result = f.query(); assert.equal(result.status, 'READ'); assert.equal(result.ownerRequirementCount, 3);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|first|second/);
});
