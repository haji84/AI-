import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCiRetry } from '../scripts/goriq-ci-retry-triage.mjs';

const sha = 'a'.repeat(40);
const repo = 'haji84/AI-';
function fixture() {
  return {
    run: { id: 42458502182, name: 'CI', event: 'pull_request_review',
      head_sha: sha, head_branch: 'feature', status: 'completed', conclusion: 'failure', run_attempt: 1 },
    jobs: { total_count: 4, jobs: [
      {id: 11, name: 'project-checks', status: 'completed', conclusion: 'success'},
      {id: 12, name: 'repository-guard', status: 'completed', conclusion: 'success'},
      {id: 13, name: 'windows-runtime-byte-fixtures', status: 'completed', conclusion: 'failure'},
      {id: 14, name: 'independent-verifier-container', status: 'completed', conclusion: 'failure'},
    ]},
    pr: { number: 1905, state: 'open', head: {sha, ref:'feature',repo:{full_name:repo}},
      base:{ref:'main',repo:{full_name:repo}} },
  };
}

test('identifies only failed jobs, retains successes and never executes', () => {
  const report = inspectCiRetry(fixture());
  assert.equal(report.decision, 'MANUAL_RETRY_ELIGIBLE_AFTER_TRANSIENT_EVIDENCE');
  assert.deepEqual(report.failed_jobs.map(x => x.id), [13,14]);
  assert.deepEqual(report.already_passed_jobs.map(x=>x.id), [11,12]);
  assert.equal(report.command_after_transient_diagnosis,
    'gh run rerun 42458502182 --failed -R haji84/AI-');
  assert.equal(report.code_fix_requires_fresh_complete_ci, true);
  assert.equal(report.scope,'READ_ONLY_NO_ACTION');
});

test('new head blocks old-SHA re-run, even if the test failures are same', () => {
  const v=fixture();v.pr.head.sha='b'.repeat(40);
  const result=inspectCiRetry(v);
  assert.equal(result.reason,'STALE_RUN_HEAD_NEW_CI_REQUIRED');
  assert.equal(result.command_after_transient_diagnosis,null);
});

test('rejects non-PR CI and main push, protecting downstream workflow_run triggers', () => {
  for(const event of ['push','workflow_dispatch','workflow_run']) {
    const v=fixture();v.run.event=event;
    assert.equal(inspectCiRetry(v).reason,'NOT_PR_CI_OR_UNSAFE_EVENT');
  }
});

test('rejects foreign, closed, main, and unauthorized PR identity', () => {
  for(const mutate of [
    v=>v.pr.state='closed',
    v=>v.pr.head.repo.full_name='attacker/repo',
    v=>v.pr.base.repo.full_name='other/repo',
    v=>v.pr.head.ref='main',
  ]) {
    const v=fixture();mutate(v);
    assert.equal(inspectCiRetry(v).reason,'PR_AUTHORITY_NOT_CONFIRMED');
  }
});

test('fails closed for partial, running, missing, or duplicated jobs',()=>{
  for(const mutate of [
    v=>v.jobs.total_count=5,
    v=>v.jobs.jobs[0].status='in_progress',
    v=>v.jobs.jobs[0].id=v.jobs.jobs[1].id,
    v=>v.jobs.jobs[0].conclusion=null,
  ]){
    const v=fixture();mutate(v);
    assert.throws(()=>inspectCiRetry(v));
  }
});

test('does not retry on cancelled or timed out jobs without separate classification',()=>{
  for(const conclusion of ['cancelled','timed_out']) {
    const v=fixture();v.jobs.jobs[0].conclusion=conclusion;
    assert.equal(inspectCiRetry(v).reason,'NON_DETERMINISTIC_JOB_STATE_REQUIRES_REVIEW');
  }
});

test('blocks exhausted attempts and zero failed jobs',()=>{
  const v=fixture();v.run.run_attempt=3;
  assert.equal(inspectCiRetry(v).reason,'RETRY_BUDGET_REQUIRES_DIAGNOSIS');
  const u=fixture();u.jobs.jobs[2].conclusion='success';u.jobs.jobs[3].conclusion='success';
  assert.equal(inspectCiRetry(u).reason,'NO_EXPLICIT_FAILED_JOBS');
});

test('does not confuse a successful run with a failure',()=>{
  const v=fixture();v.run.conclusion='success';
  assert.equal(inspectCiRetry(v).reason,'RUN_NOT_FAILED');
});
