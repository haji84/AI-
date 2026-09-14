import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync('scripts/jarvis-broker.ts', 'utf8');

test('enrollment page updates Worker before opening deep link', () => {
  assert.match(source, /最新版JARVIS Workerを更新・インストール/);
  assert.match(source, /更新後にJARVISで登録する/);
  assert.doesNotMatch(source, /window\.location\.replace\(target\)/);
  assert.match(source, /apk\.sha256Base64Url\.slice\(0, 12\)/);
});
