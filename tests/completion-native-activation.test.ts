import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCompletionActivation, prepareCompletionConfiguration, validateCompletionSource } from '../src/jarvis/completion-native-activation.ts';

const approval = JSON.parse(readFileSync('docs/authorizations/1858-native-activation.json', 'utf8'));
const now = new Date('2026-10-23T12:00:00Z');
const revision = 'b'.repeat(40);
const old = 'a49c458d69a28c0266be8fcad5b26253e5ed8d75';
const current = { version: 1, commit: old, releaseRoot: `C:\\Users\\qq113\\JARVIS\\releases\\${old}`, environment: { TOKEN: 'fixture-existing', JARVIS_DB_PATH: 'fixture' }, extra: { preserve: true } };
test('activation binds the reviewed Issue1858 PR merge, never an unrelated later main', () => {
  const proof = { number: 1863, merged: true, merge_commit_sha: revision, base: { ref: 'main', repo: { full_name: 'haji84/AI-' } }, head: { ref: 'codex/1858-native-console-host', repo: { full_name: 'haji84/AI-' } } };
  assert.doesNotThrow(() => validateCompletionSource(proof, revision));
  for (const change of [{ number: 1861 }, { merged: false }, { merge_commit_sha: old }, { head: { ...proof.head, ref: 'other' } }, { base: { ...proof.base, ref: 'other' } }, { head: { ...proof.head, repo: { full_name: 'other/AI-' } } }]) {
    assert.throws(() => validateCompletionSource({ ...proof, ...change }, revision));
  }
  assert.throws(() => validateCompletionSource(proof, 'c'.repeat(40)));
  assert.throws(() => validateCompletionSource(null, revision));
});
test('1858 scope accepts owner response only within separate forward and recovery deadlines', () => {
  assert.equal(validateCompletionActivation(approval, 'forward', now).issue, 1858);
  assert.throws(() => validateCompletionActivation(approval, 'forward', new Date('2026-10-23T14:30:00Z')));
  assert.equal(validateCompletionActivation(approval, 'recovery', new Date('2026-10-23T14:40:00Z')).issue, 1858);
  assert.throws(() => validateCompletionActivation(approval, 'recovery', new Date('2026-10-23T14:59:59Z')));
  assert.throws(() => validateCompletionActivation(approval, 'forward', new Date('2026-10-23T10:00:00Z')));
});
test('different issue, owner, proposal, operation, or extended deadline never reuse the gate', () => {
  for (const change of [{ issue: 1662 }, { issue: 1787 }, { ownerSid: 'S-1-1-0' }, { proposalSha256: 'a'.repeat(64) },
    { operation: 'root-acl' }, { expiresAt: '2026-10-24T14:59:59Z' }, { forwardUntil: '2026-10-23T14:40:00Z' }, { unexpected: true }, { ownerResponse: '' }]) {
    assert.throws(() => validateCompletionActivation({ ...approval, ...change }, 'forward', now));
  }
});
test('configuration only updates the exact native revision and release root', () => {
  const next = prepareCompletionConfiguration(current, revision, approval, now);
  assert.deepEqual(next, { ...current, commit: revision, releaseRoot: `C:\\Users\\qq113\\JARVIS\\releases\\${revision}` });
  next.environment.TOKEN = 'changed';
  assert.equal(current.environment.TOKEN, 'fixture-existing');
  assert.throws(() => prepareCompletionConfiguration({ ...current, commit: revision }, revision, approval, now));
  assert.throws(() => prepareCompletionConfiguration({ ...current, releaseRoot: current.releaseRoot.replace('qq113', 'another') }, revision, approval, now));
  assert.throws(() => prepareCompletionConfiguration(current, old, approval, now));
  assert.throws(() => prepareCompletionConfiguration(current, '../escape', approval, now));
});
