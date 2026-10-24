#!/usr/bin/env node
// Draft-only exact-Git-object inventory proof. Never executes PR files or reviews.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPinnedGitCoverage } from './goriq-ai09-pinned-coverage.mjs';
const fail = reason => { throw Error(reason); };
const SHA=/^[a-f0-9]{40}$/u;
const hash=x=>createHash('sha256').update(x).digest('hex');
const baseSha=process.env.AI09_BASE_SHA ?? '';
const headSha=process.env.AI09_HEAD_SHA ?? '';
const owner=process.env.GITHUB_REPOSITORY;
const branch=process.env.GITHUB_HEAD_REF;
const event=process.env.GITHUB_EVENT_NAME;
const proof={
  schemaVersion:1,kind:'DRAFT_GIT_SOURCE_INVENTORY_NOT_MODEL_REVIEW',
  baseSha,headSha,status:'BLOCKED',reviewedFiles:0,reviewedSlices:0,
  independentModelVerified:false,githubApprovalSatisfied:false,
  mergeAuthorized:false,completionAccepted:false,
};
try {
  if (!SHA.test(baseSha) || !SHA.test(headSha) || baseSha===headSha ||
      owner!=='haji84/AI-' || event!=='pull_request' ||
      branch!=='feat/1831-remote-lite-manual-boundary' ||
      process.env.AI09_PR_NUMBER!=='1832' ||
      execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==headSha)
    fail('AI09_INVENTORY_SCOPE_INVALID');
  // Diff path enumeration is separate from the name-status parsing performed
  // by planPinnedGitCoverage. Both must agree exactly, including rename names.
  const pathBuffer=execFileSync('git',['diff','--no-ext-diff','--no-textconv',
    '--name-only','-z','--find-renames',baseSha,headSha],
  {encoding:'buffer',timeout:20000,maxBuffer:4*1024*1024});
  if(!pathBuffer.length || pathBuffer[pathBuffer.length-1]!==0)
    fail('AI09_INVENTORY_PATH_LIST_INVALID');
  const expectedPaths=pathBuffer.toString('utf8').slice(0,-1).split('\0');
  if(expectedPaths.length!==new Set(expectedPaths).size)
    fail('AI09_INVENTORY_DUPLICATE_PATH');
  const {manifest,payloads}=planPinnedGitCoverage({
    cwd:process.cwd(),baseSha,headSha,expectedPaths});
  const slices=manifest.files.flatMap(file=>file.slices);
  const sliceIdSet=new Set(slices.map(s=>s.id));
  const shardIds=manifest.shards.flatMap(shard=>shard.sliceIds);
  const allFiles=new Set(manifest.files.map(file=>file.path));
  if(manifest.files.length!==expectedPaths.length ||
     allFiles.size!==expectedPaths.length ||
     expectedPaths.some(path=>!allFiles.has(path)) ||
     slices.length===0 || slices.length!==payloads.size ||
     sliceIdSet.size!==slices.length ||
     shardIds.length!==slices.length ||
     new Set(shardIds).size!==slices.length ||
     shardIds.some(id=>!sliceIdSet.has(id)) ||
     manifest.shards.some(shard=>
       shard.sliceIds.length>24 || shard.fileCount>30 || shard.bytes>120*1024))
    fail('AI09_INVENTORY_COVERAGE_MISMATCH');
  const sliceTotal=slices.reduce((n,s)=>n+s.end-s.start,0);
  if(sliceTotal!==manifest.totalBytes)
    fail('AI09_INVENTORY_BYTES_MISMATCH');
  // 33 is an observed shard count, not a configured review limit.
  // Derive the complete pending work list from the pinned manifest.
  // No source text, model response, or approval is created here.
  const pendingJobs=manifest.shards.map(shard=>({
    shardId:shard.id, shardDigest:shard.digest,
    sliceCount:shard.sliceIds.length, sourceBytes:shard.bytes,
    fileCount:shard.fileCount, status:'MODEL_REVIEW_NOT_STARTED',
  }));
  if(pendingJobs.length!==manifest.shards.length ||
     pendingJobs.some((job,i)=>job.shardId!==i+1 || job.sliceCount<1 ||
       job.sliceCount>24 || job.fileCount>30 || job.sourceBytes>120*1024) ||
     pendingJobs.reduce((n,job)=>n+job.sliceCount,0)!==slices.length ||
     pendingJobs.reduce((n,job)=>n+job.sourceBytes,0)!==manifest.totalBytes)
    fail('AI09_INVENTORY_DYNAMIC_QUEUE_INCOMPLETE');
  proof.pendingModelReviewJobCount=pendingJobs.length;
  proof.pendingModelReviewJobs=pendingJobs;
  proof.status='SOURCE_INVENTORY_COMPLETE_REVIEW_PENDING';
  proof.fileCount=manifest.fileCount;
  proof.sliceCount=slices.length;
  proof.shardCount=manifest.shards.length;
  proof.totalBytes=manifest.totalBytes;
  proof.manifestSha256=manifest.manifestSha256;
  proof.changedPathsSha256=hash(expectedPaths.join('\0'));
  proof.manifest=manifest; // SHA-bound metadata only; never sources or prompts.
}catch(error){
  proof.failureReason=/^AI09_[A-Z0-9_]+$/u.test(error?.message??'')
    ?error.message:'AI09_INVENTORY_UNKNOWN_FAILURE';
  process.exitCode=1;
}
proof.evidenceSha256=hash(JSON.stringify(proof));
const dest=join(process.env.RUNNER_TEMP??process.cwd(),
  'ai09-draft-pinned-inventory.json');
writeFileSync(dest,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('AI09_INVENTORY_STATUS='+proof.status);
console.log('AI09_INVENTORY_FILE_COUNT='+(proof.fileCount??0));
console.log('AI09_INVENTORY_SLICE_COUNT='+(proof.sliceCount??0));
console.log('AI09_INVENTORY_SHA256='+(proof.manifestSha256??'UNAVAILABLE'));
console.log('AI09_REAL_MODEL_REVIEWS=0');
