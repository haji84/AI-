import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';

const plan = fs.readFileSync(new URL('../docs/audit/jarvis-p4-staged-physical-fleet-plan.md', import.meta.url), 'utf8');

test('P4 staged fleet plan cannot be mistaken for physical PASS evidence', () => {
  assert.match(plan, /test plan only/i);
  assert.match(plan, /not PHYSICAL PASS evidence/i);
  assert.match(plan, /must not be used to promote any PHYSICAL- or RECOVERY-gated Requirement Ledger row/i);
  assert.match(plan, /does \*\*not\*\* by itself complete P4/i);
});

test('P4 staged fleet plan covers progressive fleet boundaries and fail-closed overflow', () => {
  for (const stage of ['S1', 'S5', 'S10', 'S25', 'S50', 'S100', 'S101']) {
    assert.match(plan, new RegExp(`### ${stage} —`));
  }
  assert.match(plan, /exactly 100 unique registered fleet identities/i);
  assert.match(plan, /registration is rejected/i);
  assert.match(plan, /existing 100 identities remain unchanged/i);
});

test('P4 staged fleet plan requires durable physical evidence fields', () => {
  for (const field of [
    '`stage_id`',
    'timestamps with timezone',
    'exact commit SHA',
    'stable node ID',
    'enrollment method',
    'task ID and result ID',
    'verifier outcome',
    'operator-observed outcome',
    '`PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`',
  ]) {
    assert.ok(plan.includes(field), `missing staged fleet evidence field: ${field}`);
  }
});

test('P4 staged fleet plan preserves core security invariants', () => {
  assert.match(plan, /owner authentication remains enabled/i);
  assert.match(plan, /worker request\/result signing remains enabled/i);
  assert.match(plan, /nonce\/replay\/clock-skew protections remain enabled/i);
  assert.match(plan, /private ingress remains private/i);
  assert.match(plan, /credentials, permissions, key revocation and destructive changes remain Human-Gated/i);
});
