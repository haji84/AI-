import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { URL } from 'node:url';

const workflow = (await readFile(new URL('../.github/workflows/goriq-jarvis-production-sync.yml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const sha = 'a'.repeat(40), other = 'b'.repeat(40), repository = 'haji84/AI-';
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function guard(job) {
  const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];
  assert.ok(block, `missing ${job}`);
  const steps = block.split('    steps:\n')[1];
  assert.ok(steps?.startsWith('      - name: Authorize exact production mutation\n'), `${job} must authorize before checkout or any mutation`);
  const match = steps.match(/ {10}node <<'NODE'\n([\s\S]*?)\n {10}NODE/);
  assert.ok(match, `${job} executable guard missing`);
  return match[1].split('\n').map(line => line.slice(10)).join('\n');
}
const grant = () => ({
  main: {object: {sha}},
  runs: {workflow_runs: [{name:'CI', path:'.github/workflows/ci.yml', event:'push', head_branch:'main', head_sha:sha, status:'completed', conclusion:'success'}]},
  pulls: [{number:1741, merged_at:'2026-10-08T00:00:00Z', merge_commit_sha:sha, base:{ref:'main', repo:{full_name:repository}}, body:`<!-- ai-company-task-scope: issue:1724 -->\n<!-- ai-company-production-deploy: approved -->\n<!-- ai-company-task-authorization-expires-at: 2099-01-01T00:00:00Z -->`}],
  issue: {number:1724, user:{login:'haji84'}, body:'## Owner command\n最後まで進めて\n\n## Execution contract\nproduction-deploy-authorized: true'},
});
async function run(job, event, change = () => {}, envChange = {}) {
  const data = grant(); change(data);
  const directory = await mkdtemp(join(tmpdir(), 'sync-auth-'));
  const output = join(directory, 'output'), summary = join(directory, 'summary');
  const env = {GITHUB_REPOSITORY:repository, GITHUB_REPOSITORY_OWNER:'haji84', GITHUB_REF:'refs/heads/main', GITHUB_EVENT_NAME:event, SYNC_COMMIT_SHA:sha, GITHUB_OUTPUT:output, GITHUB_STEP_SUMMARY:summary, ...envChange};
  const routes = new Map([
    [`git/ref/heads/main`, data.main],
    [`actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=100`, data.runs],
    [`commits/${sha}/pulls`, data.pulls], ['issues/1724', data.issue],
  ]);
  let error;
  try {
    await new AsyncFunction('process','fetch','console', guard(job))({env}, async url => {
      assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
      if (data.apiError) return {ok:false, status:503};
      const route = url.slice(`https://api.github.com/repos/${repository}/`.length);
      assert.ok(routes.has(route), `unexpected API request: ${route}`);
      return {ok:true, status:200, json:async () => globalThis.structuredClone(routes.get(route))};
    }, {log(){}});
  } catch (caught) {error = caught;}
  const receipt = await readFile(output,'utf8').catch(() => '');
  await rm(directory,{recursive:true,force:true});
  return {error,receipt};
}
for (const job of ['deploy-code','sync']) {
  test(`${job} puts its executable authorization before every mutation`, () => { guard(job); });
  for (const event of ['push','schedule','workflow_dispatch','workflow_run']) {
    test(`${job}/${event} accepts only exact-main successful CI and valid owner task scope`, async () => {
      const result = await run(job,event); assert.equal(result.error,undefined); assert.match(result.receipt,/authorized=true\n/); assert.match(result.receipt,new RegExp(`deploy_sha=${sha}\\n`));
    });
    test(`${job}/${event} rejects missing task authorization even with successful CI`, async () => {
      const result=await run(job,event,d=>{d.pulls[0].body='ordinary PR';});assert.match(result.error?.message ?? "", /PRODUCTION_AUTHORIZATION_/);assert.doesNotMatch(result.receipt,/authorized=true/);
    });
  }
  const cases = [
    ['stale main',d=>{d.main.object.sha=other;}],
    ['missing CI',d=>{d.runs.workflow_runs=[];}],
    ['failed CI',d=>{d.runs.workflow_runs[0].conclusion='failure';}],
    ['pending latest CI cannot reuse older success',d=>{d.runs.workflow_runs.unshift({...d.runs.workflow_runs[0],status:'in_progress',conclusion:null});}],
    ['PR CI is not main push CI',d=>{d.runs.workflow_runs[0].event='pull_request';}],
    ['wrong CI SHA',d=>{d.runs.workflow_runs[0].head_sha=other;}],
    ['wrong CI workflow',d=>{d.runs.workflow_runs[0].path='.github/workflows/other.yml';}],
    ['missing merged PR',d=>{d.pulls=[];}],
    ['wrong merge SHA',d=>{d.pulls[0].merge_commit_sha=other;}],
    ['unmerged PR',d=>{d.pulls[0].merged_at=null;}],
    ['wrong PR base repository',d=>{d.pulls[0].base.repo.full_name='other/repo';}],
    ['expired scope',d=>{d.pulls[0].body=d.pulls[0].body.replace('2099-01-01','2000-01-01');}],
    ['malformed expiry',d=>{d.pulls[0].body=d.pulls[0].body.replace('2099-01-01T00:00:00Z','invalid');}],
    ['non-owner issue',d=>{d.issue.user.login='someone-else';}],
    ['non-completion command',d=>{d.issue.body=d.issue.body.replace('最後まで進めて','進めて');}],
    ['issue approval absent',d=>{d.issue.body=d.issue.body.replace('true','false');}],
    ['API failure',d=>{d.apiError=true;}],
  ];
  for(const [name,change] of cases)test(`${job} fails closed: ${name}`,async()=>{const r=await run(job,'workflow_dispatch',change);assert.match(r.error?.message ?? "", /PRODUCTION_AUTHORIZATION_/);assert.doesNotMatch(r.receipt,/authorized=true/);});
  for(const [name,env] of [['branch',{GITHUB_REF:'refs/heads/feature'}],['event',{GITHUB_EVENT_NAME:'pull_request'}],['repository',{GITHUB_REPOSITORY:'other/repo'}],['SHA',{SYNC_COMMIT_SHA:'invalid'}]])test(`${job} rejects invalid ${name} context`,async()=>{const r=await run(job,'push',()=>{},env);assert.match(r.error?.message ?? "", /PRODUCTION_AUTHORIZATION_/);assert.doesNotMatch(r.receipt,/authorized=true/);});
}
const scopedWorkflow = (await readFile(new URL('../.github/workflows/vercel-scoped-production-deploy.yml', import.meta.url), 'utf8')).replaceAll('\r\n','\n');
const scopedBody = scopedWorkflow.match(/ {10}node <<'NODE'\n([\s\S]*?)\n {10}NODE/)[1].split('\n').map(line=>line.slice(10)).join('\n').replace('import { appendFile } from "node:fs/promises";', 'const { appendFile } = await import("node:fs/promises");');
async function scopedDecision(change) {
  const data=grant();change(data);
  const directory=await mkdtemp(join(tmpdir(),'scoped-auth-')), output=join(directory,'output');
  try {
    await new AsyncFunction('process','fetch','console',scopedBody)({env:{GH_TOKEN:'fixture-only',REPOSITORY:repository,REPOSITORY_OWNER:'haji84',DEPLOY_SHA:sha,GITHUB_OUTPUT:output},exit(code){throw {scopedExit:code};}},async url=>{
      const path=url.slice(`https://api.github.com/repos/${repository}`.length);
      assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
      assert.ok([`/commits/${sha}/pulls`,'/issues/1724'].includes(path));
      return {ok:true,json:async()=>globalThis.structuredClone(path.endsWith('/pulls')?data.pulls:data.issue)};
    },{log(){}});
  } catch(error) { if(error?.scopedExit!==0)throw error; }
  const receipt=await readFile(output,'utf8');await rm(directory,{recursive:true,force:true});
  return receipt.includes('authorized=true\n');
}
for(const [name,change,want] of [
  ['valid exact task',()=>{},true],
  ['missing task marker',d=>{d.pulls[0].body='';},false],
  ['expired task',d=>{d.pulls[0].body=d.pulls[0].body.replace('2099-01-01','2000-01-01');},false],
  ['different owner',d=>{d.issue.user.login='other';},false],
  ['inspect instruction',d=>{d.issue.body=d.issue.body.replace('最後まで進めて','状態確認');},false],
  ['unrecognized completion wording remains unchanged',d=>{d.issue.body=d.issue.body.replace('最後まで進めて','完了まで全て承認');},false],
  ['missing production permission',d=>{d.issue.body=d.issue.body.replace('true','false');},false],
])test(`legacy and scoped deployment contracts agree: ${name}`,async()=>{
  assert.equal(await scopedDecision(change),want);
  for(const job of ['sync','deploy-code']){const result=await run(job,'workflow_run',change);assert.equal(result.receipt.includes('authorized=true\n'),want);}
});