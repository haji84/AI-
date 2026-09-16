import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';

const foundation = fs.readFileSync(new URL('./jarvis-v1-foundation.test.ts', import.meta.url), 'utf8');
const audit = fs.readFileSync(new URL('../docs/audit/jarvis-p4-capacity-evidence-2026-09-16.md', import.meta.url), 'utf8');

test('P4 capacity evidence pins the 100-node boundary and fail-closed node 101 assertion', () => {
  assert.match(foundation, /for \(let i = 1; i <= JARVIS_MAX_NODES; i \+= 1\)/);
  assert.match(foundation, /assert\.equal\(fleet\.list\(\)\.length, 100\)/);
  assert.match(foundation, /android-101/);
  assert.match(foundation, /fleet limit exceeded/);
  assert.match(audit, /FLEET-010/);
  assert.match(audit, /FLEET-011/);
  assert.match(audit, /does not claim physical 100-device acceptance/i);
});
