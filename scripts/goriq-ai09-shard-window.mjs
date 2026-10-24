import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const refuse = code => { throw new Error(code); };

/**
 * Advisory input selector for ONE shard of a pinned, full-diff AI09 plan.
 * Hashes and reconstructs every source side before selecting a shard, so an
 * omitted or mutated unrelated slice cannot silently become a valid window.
 * This does NOT authenticate a reviewer or invoke a model; never archive text.
 */
export function selectPinnedReviewShard({ manifest, payloads, shardId } = {}) {
  if (!manifest || !(payloads instanceof Map) || !Number.isSafeInteger(shardId) ||
      shardId < 1 || !SHA40.test(manifest.baseSha ?? '') ||
      !SHA40.test(manifest.headSha ?? '') || manifest.baseSha === manifest.headSha ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 500 ||
      manifest.fileCount !== manifest.files.length || !Array.isArray(manifest.shards) ||
      !manifest.shards.length || manifest.shards.length > 500 ||
      !SHA256.test(manifest.manifestSha256 ?? '') ||
      manifest.manifestSha256 !== sha256(JSON.stringify({ ...manifest, manifestSha256: null })))
    refuse('AI09_SHARD_SCOPE_INVALID');

  const seenPaths = new Set();
  const byId = new Map();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !file.path || seenPaths.has(file.path) ||
        !Array.isArray(file.slices)) refuse('AI09_SHARD_FILE_INVALID');
    seenPaths.add(file.path);
    for (const side of ['before', 'after']) {
      const bytesExpected = file[side + 'Bytes'];
      const sideHash = file[side + 'Sha256'];
      if (!Number.isSafeInteger(bytesExpected) || bytesExpected < 0 ||
          (sideHash !== null && !SHA256.test(sideHash ?? '')))
        refuse('AI09_SHARD_SIDE_INVALID');
      const pieces = [];
      let cursor = 0;
      for (const slice of file.slices.filter(s => s?.side === side)) {
        if (slice.path !== file.path || !Number.isSafeInteger(slice.id) ||
            slice.id < 1 || byId.has(slice.id) ||
            !Number.isSafeInteger(slice.start) || slice.start !== cursor ||
            !Number.isSafeInteger(slice.end) || slice.end <= cursor ||
            slice.end - slice.start > 4096 || !SHA256.test(slice.sha256 ?? ''))
          refuse('AI09_SHARD_SLICE_INVALID');
        const text = payloads.get(slice.id);
        if (typeof text !== 'string') refuse('AI09_SHARD_INPUT_MISSING');
        const content = Buffer.from(text, 'utf8');
        if (content.length !== slice.end - slice.start || sha256(content) !== slice.sha256)
          refuse('AI09_SHARD_SOURCE_CHANGED');
        pieces.push(content);
        byId.set(slice.id, { ...slice, text });
        cursor = slice.end;
      }
      if (cursor !== bytesExpected ||
          (sideHash === null && (bytesExpected !== 0 || pieces.length)) ||
          (sideHash !== null && sha256(Buffer.concat(pieces)) !== sideHash))
        refuse('AI09_SHARD_SOURCE_INCOMPLETE');
      totalBytes += bytesExpected;
    }
    if (file.slices.some(s => !s || !['before', 'after'].includes(s.side)))
      refuse('AI09_SHARD_SLICE_INVALID');
  }
  if (totalBytes !== manifest.totalBytes || byId.size === 0 ||
      byId.size > 4096 || payloads.size !== byId.size)
    refuse('AI09_SHARD_TOTAL_MISMATCH');

  const scheduled = new Set();
  for (let i = 0; i < manifest.shards.length; i++) {
    const shard = manifest.shards[i];
    if (shard?.id !== i + 1 || !Array.isArray(shard.sliceIds) ||
        !shard.sliceIds.length || shard.sliceIds.length > 24 ||
        !Number.isSafeInteger(shard.bytes) || shard.bytes > 120 * 1024 ||
        !Number.isSafeInteger(shard.fileCount) || shard.fileCount > 30 ||
        shard.sliceIds.some(id => !byId.has(id) || scheduled.has(id)))
      refuse('AI09_SHARD_LAYOUT_INVALID');
    const slices = shard.sliceIds.map(id => byId.get(id));
    if (slices.reduce((n, s) => n + s.end - s.start, 0) !== shard.bytes ||
        new Set(slices.map(s => s.path)).size !== shard.fileCount ||
        sha256(JSON.stringify({ baseSha: manifest.baseSha, headSha: manifest.headSha,
          index: shard.id, slices: slices.map(s => ({ id:s.id, path:s.path, side:s.side,
            start:s.start, end:s.end, sha256:s.sha256 })) })) !== shard.digest)
      refuse('AI09_SHARD_DIGEST_MISMATCH');
    shard.sliceIds.forEach(id => scheduled.add(id));
  }
  if (scheduled.size !== byId.size) refuse('AI09_SHARD_UNSCHEDULED_INPUT');
  const requested = manifest.shards[shardId - 1];
  if (!requested) refuse('AI09_SHARD_ID_INVALID');
  return {
    status: 'SHARD_INPUT_READY_REVIEW_PENDING',
    baseSha: manifest.baseSha, headSha: manifest.headSha,
    manifestSha256: manifest.manifestSha256,
    shardId, shardDigest: requested.digest,
    sourceBytes: requested.bytes, totalSourceBytes: manifest.totalBytes,
    fileCount: requested.fileCount, totalFileCount: manifest.fileCount,
    shardCount: manifest.shards.length,
    slices: requested.sliceIds.map(id => byId.get(id)),
    reviewedFiles: 0, reviewedShards: 0,
    independentReviewerAuthenticated: false,
    githubApprovalSatisfied: false, mergeAuthorized: false,
  };
}

/**
 * Trusted-runner advisory, one dynamically selected shard per invocation.
 * A caller must authenticate the model and GitHub runner independently.
 * An isolated shard is NEVER a whole-PR pass or GitHub APPROVED.
 */
export async function reviewPinnedShard({ plan, shardId, infer, reviewerId = 'AI09-trusted' } = {}) {
  if (typeof infer !== 'function' || !/^[A-Za-z0-9_.:-]{2,80}$/u.test(reviewerId) ||
      reviewerId === 'Builder') refuse('AI09_SHARD_REVIEW_CALL_INVALID');
  const window = selectPinnedReviewShard({
    manifest: plan?.manifest, payloads: plan?.payloads, shardId,
  });
  const { reviewLocalPatch } = await import('../src/orchestrator/ai09-local-reviewer.mjs');
  const digest = sha256;
  const results = [];
  let status = 'NO_ACTIONABLE_FINDINGS';
  for (const s of window.slices) {
    const patch = 'PINNED_FILE_SLICE id=' + s.id + ' side=' + s.side +
      ' byteRange=' + s.start + ':' + s.end + ' sha256=' + s.sha256 +
      '\nBEGIN_UNTRUSTED_FILE_CONTENT\n' + s.text + '\nEND_UNTRUSTED_FILE_CONTENT';
    let requestSha256 = null, responseSha256 = null;
    const checkedInfer = async prompt => {
      requestSha256 = digest(Buffer.from(prompt, 'utf8'));
      const response = await infer(prompt);
      if (typeof response !== 'string' || Buffer.byteLength(response, 'utf8') > 20000)
        refuse('AI09_SHARD_INFER_RESPONSE_INVALID');
      responseSha256 = digest(Buffer.from(response, 'utf8'));
      return response;
    };
    const review = await reviewLocalPatch({
      baseSha: window.baseSha, headSha: window.headSha, makerRole: 'Builder',
      paths: [s.path], patch, infer: checkedInfer,
    });
    if (review.status === 'BLOCKED' || !requestSha256 || !responseSha256)
      return {status:'BLOCKED', reason:'AI09_SHARD_MODEL_OR_EVIDENCE_BLOCKED',
        shardId, evaluatedSlices:results.length, githubApprovalSatisfied:false,
        independentReviewerAuthenticated:false, mergeAuthorized:false};
    if (review.status === 'INCONCLUSIVE') status = 'INCONCLUSIVE';
    else if (review.status === 'CHANGES_REQUESTED' && status !== 'INCONCLUSIVE')
      status = 'CHANGES_REQUESTED';
    results.push({
      sliceId:s.id, reviewSha256:digest(JSON.stringify(review)),
      requestSha256, responseSha256, status:review.status,
      findingCount:review.findings.length,
    });
  }
  const receipt = {
    shardId, shardDigest:window.shardDigest, manifestSha256:window.manifestSha256,
    baseSha:window.baseSha, headSha:window.headSha, reviewerId, status,
    evidenceSha256:digest(JSON.stringify(results)),
    evaluatedSliceIds:results.map(x=>x.sliceId),sliceResults:results,
  };
  return {
    status, receipt, shardId, evaluatedSlices:results.length,
    manifestSha256:window.manifestSha256, provenance:'AI_ASSERTED',
    independentReviewerAuthenticated:false, formalGitHubReview:false,
    githubApprovalSatisfied:false, mergeAuthorized:false,
  };
}
