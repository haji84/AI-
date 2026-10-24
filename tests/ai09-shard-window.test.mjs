import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { planFullCoverage, verifyFullCoverageReceipts } from '../src/orchestrator/ai09-full-coverage.mjs';
import { selectPinnedReviewShard } from '../scripts/goriq-ai09-shard-window.mjs';

const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
function source() {
  const files = Array.from({ length: 215 }, (_, i) => ({
    path: 'test/file-' + i + '.mjs', status: 'added', before: null,
    after: Buffer.from(i === 0 ? 'notice code\n'.repeat(34000) : 'source ' + i + '\n'),
  }));
  return planFullCoverage({ baseSha, headSha, files, expectedPaths: files.map(f => f.path) });
}

test('realistic 215-path sharding selects one complete source-bound job, never an approval', () => {
  const plan = source();
  assert.ok(plan.manifest.shards.length > 1);
  for (const id of [1, plan.manifest.shards.length]) {
    const job = selectPinnedReviewShard({ manifest: plan.manifest, payloads: plan.payloads, shardId: id });
    assert.equal(job.shardId, id);
    assert.equal(job.status, 'SHARD_INPUT_READY_REVIEW_PENDING');
    assert.equal(job.slices.length, plan.manifest.shards[id - 1].sliceIds.length);
    assert.equal(job.sourceBytes, plan.manifest.shards[id - 1].bytes);
    assert.equal(job.reviewedFiles, 0);
    assert.equal(job.independentReviewerAuthenticated, false);
    assert.equal(job.githubApprovalSatisfied, false);
    assert.equal(job.mergeAuthorized, false);
  }
  assert.equal(verifyFullCoverageReceipts(plan.manifest, []).status, 'BLOCKED');
});

test('missing or altered slice from ANY shard blocks even if the requested shard is unaffected', () => {
  const original = source();
  const lastId = Math.max(...original.payloads.keys());
  original.payloads.set(lastId, 'altered');
  assert.throws(() => selectPinnedReviewShard({ manifest: original.manifest,
    payloads: original.payloads, shardId: 1 }), /SOURCE_CHANGED|SOURCE_INCOMPLETE/u);
  const absent = source();
  absent.payloads.delete(Math.max(...absent.payloads.keys()));
  assert.throws(() => selectPinnedReviewShard({ manifest: absent.manifest,
    payloads: absent.payloads, shardId: 1 }), /INPUT_MISSING/u);
});

test('changed manifest, missing shard and nonexistent job cannot be accepted', () => {
  const p = source();
  p.manifest.shards[0].sliceIds.pop();
  assert.throws(() => selectPinnedReviewShard({ manifest: p.manifest,
    payloads: p.payloads, shardId: 1 }), /SCOPE_INVALID/u);
  const q = source();
  assert.throws(() => selectPinnedReviewShard({ manifest: q.manifest,
    payloads: q.payloads, shardId: q.manifest.shards.length + 1 }), /SHARD_ID_INVALID/u);
});
