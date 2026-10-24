import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const SHA = /^[a-f0-9]{40}$/u;
const STATUSES = new Set(['added', 'deleted', 'modified', 'renamed']);
const REVIEW_STATUSES = new Set(['NO_ACTIONABLE_FINDINGS', 'CHANGES_REQUESTED', 'INCONCLUSIVE', 'BLOCKED']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };

function safePath(p) {
  return typeof p === 'string' && p.length > 0 && Buffer.byteLength(p) <= 250 &&
    !p.startsWith('/') && !p.startsWith('-') && !p.includes('\\') &&
    !p.split('/').some(s => !s || s === '.' || s === '..') &&
    !/[\u0000-\u001f\u007f]/u.test(p);
}

function textSlices(bytes, byteLimit) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return [];
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('AI09_NON_TEXT_REQUIRES_INDEPENDENT_REVIEW'); }
  if (content.includes('\u0000')) fail('AI09_BINARY_REQUIRES_INDEPENDENT_REVIEW');
  let current = '', size = 0, offset = 0;
  const result = [];
  const push = () => {
    if (!size) return;
    result.push({ start: offset, end: offset + size, sha256: sha256(Buffer.from(current, 'utf8')), text: current });
    offset += size; current = ''; size = 0;
  };
  for (const char of content) {
    const n = Buffer.byteLength(char, 'utf8');
    if (n > byteLimit) fail('AI09_UNSPLITTABLE_UTF8');
    if (size + n > byteLimit) push();
    current += char; size += n;
  }
  push();
  if (offset !== bytes.length || !Buffer.concat(result.map(x => Buffer.from(x.text, 'utf8'))).equals(bytes))
    fail('AI09_SLICE_COVERAGE_MISMATCH');
  return result;
}

/**
 * Candidate, not an approval engine. Callers must independently attest the
 * GitHub changed-file list and both pinned Git trees. It never executes code.
 * It reviews BOTH complete old/new text blobs, which covers every changed byte.
 */
export function planFullCoverage({ baseSha, headSha, files, expectedPaths, maxSliceBytes = 4096 } = {}) {
  if (!SHA.test(baseSha ?? '') || !SHA.test(headSha ?? '') || baseSha === headSha ||
      !Number.isSafeInteger(maxSliceBytes) || maxSliceBytes < 64 || maxSliceBytes > 4096 ||
      !Array.isArray(files) || !files.length || files.length > 500 ||
      !Array.isArray(expectedPaths) || expectedPaths.length !== files.length)
    fail('AI09_FULL_COVERAGE_SCOPE_INVALID');
  const seen = new Set(), expected = new Set();
  for (const p of expectedPaths) {
    if (!safePath(p) || expected.has(p)) fail('AI09_AUTHORITATIVE_PATH_LIST_INVALID');
    expected.add(p);
  }
  const records = [], payloads = new Map(), pending = [];
  let totalBytes = 0, sliceNumber = 0;
  for (const entry of files) {
    const { path, status, previousPath, before, after } = entry ?? {};
    if (!safePath(path) || !expected.has(path) || seen.has(path) ||
        !STATUSES.has(status) || (status === 'renamed' && (!safePath(previousPath) || previousPath === path)) ||
        (status !== 'renamed' && previousPath !== undefined) ||
        (before !== null && !Buffer.isBuffer(before)) ||
        (after !== null && !Buffer.isBuffer(after)) ||
        (status === 'added' && (before !== null || !Buffer.isBuffer(after))) ||
        (status === 'deleted' && (!Buffer.isBuffer(before) || after !== null)) ||
        (['modified', 'renamed'].includes(status) && (!Buffer.isBuffer(before) || !Buffer.isBuffer(after))))
      fail('AI09_CHANGED_FILE_INCONSISTENT');
    seen.add(path);
    const beforeBytes = before?.length ?? 0, afterBytes = after?.length ?? 0;
    totalBytes += beforeBytes + afterBytes;
    if (totalBytes > 40 * 1024 * 1024 || beforeBytes > 8 * 1024 * 1024 || afterBytes > 8 * 1024 * 1024)
      fail('AI09_REVIEW_BUDGET_EXCEEDED');
    const slices = [];
    for (const [side, buffer] of [['before',before],['after',after]]) {
      if (buffer === null) continue;
      for (const slice of textSlices(buffer, maxSliceBytes)) {
        const id = ++sliceNumber;
        const metadata = { id, path, side, start: slice.start, end: slice.end, sha256: slice.sha256 };
        slices.push(metadata); pending.push(metadata);
        payloads.set(id, slice.text);
      }
    }
    records.push({ path, status, ...(previousPath ? { previousPath } : {}),
      beforeBytes, afterBytes, beforeSha256: before === null ? null : sha256(before),
      afterSha256: after === null ? null : sha256(after), slices });
  }
  if (seen.size !== expected.size) fail('AI09_MISSING_CHANGED_FILES');
  const shards = [];
  let group = [], paths = new Set(), size = 0;
  const flush = () => {
    if (!group.length) return;
    const index = shards.length + 1;
    const scope = { baseSha, headSha, index, slices: group };
    shards.push({ id:index, digest:sha256(JSON.stringify(scope)), sliceIds: group.map(s => s.id),
      fileCount:paths.size, bytes:size });
    group = []; paths = new Set(); size = 0;
  };
  for (const part of pending) {
    const n = part.end - part.start;
    if (group.length && (group.length === 24 || paths.size === 30 && !paths.has(part.path) || size + n > 120 * 1024))
      flush();
    group.push(part); paths.add(part.path); size += n;
  }
  flush();
  if (!shards.length || shards.length > 500 ||
      shards.reduce((n,x) => n + x.sliceIds.length, 0) !== pending.length)
    fail('AI09_SHARD_COVERAGE_INCOMPLETE');
  const manifest = { version:1, baseSha, headSha, fileCount:files.length, totalBytes,
    files:records, shards, manifestSha256:null };
  manifest.manifestSha256 = sha256(JSON.stringify({ ...manifest, manifestSha256:null }));
  return { manifest, payloads };
}

/** An advisory audit only, never GitHub approval, merge authority, or deployment. */
export function verifyFullCoverageReceipts(manifest, receipts) {
  const blocked = reason => ({ status:'BLOCKED', reason, githubApprovalSatisfied:false, mergeAuthorized:false,
    evidenceClass:'AI_ASSERTED' });
  if (!manifest || !SHA.test(manifest.baseSha ?? '') || !SHA.test(manifest.headSha ?? '') ||
      manifest.manifestSha256 !== sha256(JSON.stringify({ ...manifest, manifestSha256:null })) ||
      !Array.isArray(manifest.shards) || !Array.isArray(receipts) ||
      receipts.length !== manifest.shards.length) return blocked('AI09_RECEIPT_SET_MISSING');
  const seen = new Set(); let advisory = 'NO_ACTIONABLE_FINDINGS';
  for (const r of receipts) {
    if (!r || !Number.isSafeInteger(r.shardId) || seen.has(r.shardId)) return blocked('AI09_DUPLICATE_SHARD');
    seen.add(r.shardId);
    const s = manifest.shards.find(x => x.id === r.shardId);
    if (!s || r.manifestSha256 !== manifest.manifestSha256 ||
        r.baseSha !== manifest.baseSha || r.headSha !== manifest.headSha ||
        r.shardDigest !== s.digest || typeof r.reviewerId !== 'string' ||
        !/^[A-Za-z0-9_.:-]{2,80}$/u.test(r.reviewerId) || r.reviewerId === 'Builder' ||
        !REVIEW_STATUSES.has(r.status)) return blocked('AI09_RECEIPT_INTEGRITY_FAIL');
    if (r.status === 'BLOCKED') return blocked('AI09_SHARD_BLOCKED');
    if (r.status === 'INCONCLUSIVE') advisory = 'INCONCLUSIVE';
    if (r.status === 'CHANGES_REQUESTED' && advisory !== 'INCONCLUSIVE') advisory = 'CHANGES_REQUESTED';
  }
  return { status:advisory, reviewedShards:seen.size, reviewedFiles:manifest.fileCount,
    manifestSha256:manifest.manifestSha256, githubApprovalSatisfied:false,
    mergeAuthorized:false, evidenceClass:'AI_ASSERTED' };
}
