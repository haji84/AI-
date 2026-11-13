/**
 * Issue #1845: read-only, exact-head advice for GitHub's built-in failed-job rerun.
 * No GitHub API requests, workflows, mutations, or automatic retries occur here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = 'haji84/AI-';
const SHA = /^[a-f0-9]{40}$/;
const isId = n => Number.isSafeInteger(n) && n > 0;

function fail(code) { throw new Error(code); }

export function inspectCiRetry({ run, jobs, pr }) {
  if (!run || !jobs || !pr || typeof run !== 'object' ||
      typeof jobs !== 'object' || typeof pr !== 'object') fail('INPUT_OBJECT_REQUIRED');
  if (!isId(run.id) || !SHA.test(run.head_sha || '') ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
      !isId(pr.number)) fail('INVALID_RUN_OR_PR_IDENTITY');
  if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) ||
      jobs.total_count !== jobs.jobs.length || jobs.jobs.length > 100) {
    fail('INCOMPLETE_OR_INVALID_JOB_LIST');
  }
  const validResults = new Set(['success', 'failure', 'skipped', 'cancelled', 'timed_out', 'neutral', 'action_required', 'startup_failure']);
  const seen = new Set();
  for (const job of jobs.jobs) {
    if (!isId(job.id) || seen.has(job.id) || typeof job.name !== 'string' ||
        job.name.length > 160 || !validResults.has(job.conclusion) ||
        job.status !== 'completed') fail('INVALID_OR_INCOMPLETE_JOB');
    seen.add(job.id);
  }
  const failing = jobs.jobs.filter(job => job.conclusion === 'failure');
  const passed = jobs.jobs.filter(job => job.conclusion === 'success');
  const report = {
    schema: 'GORIQ_CI_SELECTIVE_RETRY_TRIAGE_V1',
    scope: 'READ_ONLY_NO_ACTION',
    repository: REPO,
    run_id: run.id,
    original_sha: run.head_sha,
    pr_number: pr.number,
    run_attempt: run.run_attempt,
    failed_jobs: failing.map(x => ({ id: x.id, name: x.name })),
    already_passed_jobs: passed.map(x => ({ id: x.id, name: x.name })),
    decision: 'BLOCKED',
    reason: '',
    command_after_transient_diagnosis: null,
    code_fix_requires_fresh_complete_ci: true,
  };
  const block = reason => ({ ...report, reason });
  if (run.name !== 'CI' || !['pull_request', 'pull_request_review'].includes(run.event)) {
    return block('NOT_PR_CI_OR_UNSAFE_EVENT');
  }
  if (run.status !== 'completed') return block('RUN_NOT_COMPLETED');
  if (run.conclusion !== 'failure') return block('RUN_NOT_FAILED');
  if (pr.state !== 'open' || pr.base?.ref !== 'main' ||
      pr.head?.repo?.full_name !== REPO || pr.base?.repo?.full_name !== REPO ||
      typeof pr.head?.ref !== 'string' || pr.head.ref === 'main') {
    return block('PR_AUTHORITY_NOT_CONFIRMED');
  }
  if (pr.head.sha !== run.head_sha ||
      (typeof run.head_branch === 'string' && run.head_branch !== pr.head.ref)) {
    return block('STALE_RUN_HEAD_NEW_CI_REQUIRED');
  }
  if (jobs.jobs.some(x => !['success', 'failure', 'skipped'].includes(x.conclusion))) {
    return block('NON_DETERMINISTIC_JOB_STATE_REQUIRES_REVIEW');
  }
  if (failing.length === 0) return block('NO_EXPLICIT_FAILED_JOBS');
  if (run.run_attempt >= 3) return block('RETRY_BUDGET_REQUIRES_DIAGNOSIS');
  return {
    ...report,
    decision: 'MANUAL_RETRY_ELIGIBLE_AFTER_TRANSIENT_EVIDENCE',
    reason: 'SAME_PR_HEAD_AND_FAILED_JOBS_CONFIRMED',
    command_after_transient_diagnosis: `gh run rerun ${run.id} --failed -R ${REPO}`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 5) fail('USAGE_RUN_JSON_JOBS_JSON_PR_JSON');
    const [run, jobs, pr] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
    const report = inspectCiRetry({run, jobs, pr});
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.decision === 'BLOCKED') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`CI_RETRY_TRIAGE:${error.message}\n`);
    process.exitCode = 3;
  }
}
