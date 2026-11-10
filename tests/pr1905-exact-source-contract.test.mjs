import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreR66WorkflowBaseline, PIN_BLOCKS } from './fixtures/pr1905-ci-source-contract.mjs';

const base = '# before\njobs:\n  repository-guard:\n    steps:\n      - uses: actions/checkout@v4\n      - run: guard\n  project-checks:\n    steps:\n      - uses: actions/checkout@v4\n      - run: tests\n  independent-verifier-container:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n  windows-runtime-byte-fixtures:\n    steps:\n      - uses: actions/checkout@v4\n      - run: windows\n';
function pinned() {
  let text = base;
  for (const [job, block] of Object.entries(PIN_BLOCKS)) {
    const anchor = `  ${job}:\n    steps:\n      - uses: actions/checkout@v4\n`;
    text = text.replace(anchor, `  ${job}:\n    steps:\n${block}`);
  }
  return text;
}
test('strict source pins preserve every byte outside the three approved checkout blocks', () => {
  assert.equal(restoreR66WorkflowBaseline(pinned()), base);
});
test('missing, wrong-head, wrong-check, duplicated and misplaced pins are rejected', () => {
  for (const transform of [
    s => s.replace(PIN_BLOCKS['project-checks'], '      - uses: actions/checkout@v4\n'),
    s => s.replace('ref: ${{ github.event.pull_request.head.sha || github.sha }}', 'ref: main'),
    s => s.replace('test "$(git rev-parse HEAD)" = "$GORIQ_EXPECTED_SOURCE_SHA"', 'true'),
    s => s.replace(PIN_BLOCKS['repository-guard'], PIN_BLOCKS['repository-guard'].repeat(2)),
    s => s.replace('  project-checks:\n', '  unrelated:\n'),
    s => s.replace('SOURCE_SHA_MISMATCH', 'IGNORED'),
  ]) assert.throws(() => restoreR66WorkflowBaseline(transform(pinned())), /EXACT_HEAD_CHECKOUT_CONTRACT/);
});
test('normalization never erases unrelated permissions, limits or test commands', () => {
  for (const token of ['contents: write', 'timeout-minutes: 99', 'continue-on-error: true', '--test-name-pattern=only-one']) {
    const input = pinned() + token + '\n';
    assert.equal(restoreR66WorkflowBaseline(input), base + token + '\n');
  }
});

// Exercise the real checked-in workflow, not only synthetic job fragments.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const actualWorkflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const r66Marker="      - name: Collect bounded public test runtime facts\n        if: always()\n        timeout-minutes: 1\n        shell: bash\n        run: |\n          python3 - <<'PY'\n";
const start=actualWorkflow.indexOf(r66Marker),end=actualWorkflow.indexOf("          PY\n",start+r66Marker.length);
assert.ok(start>=0&&end>start);
const addition=actualWorkflow.slice(start,end+"          PY\n".length);
const digest=source=>createHash('sha256').update(restoreR66WorkflowBaseline(source.replace(addition,''))).digest('hex');
const priorDigest='e5cd90e8c3d25858d85eb44959f11206db46bd850ee7e6e2e0dc7dc4f7286c26';
test('real three exact-head additions preserve every original R66 workflow byte',()=>{
 assert.equal(digest(actualWorkflow),priorDigest);
 assert.notEqual(createHash('sha256').update(actualWorkflow.replace(addition,'')).digest('hex'),priorDigest);
});
test('real workflow permissions budgets filters and diagnostics cannot be hidden behind normalization',()=>{
 for(const [before,after] of [['contents: read','contents: write'],['timeout-minutes: 10','timeout-minutes: 11'],['run: pnpm test\n','run: pnpm test --test-name-pattern=skip\n'],['timeout-minutes: 35','timeout-minutes: 36']]){
  assert.equal(actualWorkflow.split(before).length,2);
  assert.notEqual(digest(actualWorkflow.replace(before,after)),priorDigest);
 }
 for(const [before,after] of [['test "$(git rev-parse HEAD)" = "$GORIQ_EXPECTED_SOURCE_SHA"','true'],["throw 'SOURCE_SHA_MISMATCH'","Write-Host 'SOURCE_SHA_MISMATCH'"]]){
  assert.throws(()=>digest(actualWorkflow.replace(before,after)),/EXACT_HEAD_CHECKOUT_CONTRACT/);
 }
});
