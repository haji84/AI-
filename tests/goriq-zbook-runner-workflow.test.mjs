import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import process from 'node:process';
const workflow=readFileSync('.github/workflows/goriq-pc-private-network-probe.yml','utf8');
test('boolean route-only entry can queue only Mac and preserves normal matrix and guard',()=>{
  assert.match(workflow,/zbook_runner_only:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
  const expression=workflow.match(/runner: \$\{\{ (.*) \}\}/)?.[1];assert.ok(expression);
  for(const value of [true,false]) {
    const runners=runInNewContext(expression,{inputs:{zbook_runner_only:value},fromJSON:JSON.parse});
    assert.deepEqual(JSON.parse(JSON.stringify(runners)),value?[['self-hosted','macOS','ARM64']]:[['self-hosted','macOS','ARM64'],['self-hosted','Windows','X64']]);
  }
  assert.match(workflow,/contents: read/);assert.match(workflow,/timeout-minutes: 3/);assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/if: github.repository == 'haji84\/AI-' && github.ref == 'refs\/heads\/main' && github.actor == 'haji84'/);
  const guard=workflow.indexOf('run: node scripts/goriq-pc-approved-source.mjs');
  assert.ok(guard>0);assert.ok(guard<workflow.indexOf('run: node scripts/goriq-zbook-runner-readonly.mjs'));
  assert.match(workflow,/if: \$\{\{ !inputs.zbook_runner_only \}\}\n\s+working-directory:.*\n\s+run: node scripts\/goriq-pc-private-network-probe.mjs/);
});
test('all modes reject retained source paths without touching original bytes',()=>{
  const source=workflow.match(/run: >-\n\s+node -e '([^']+)'/)?.[1];assert.ok(source,'inline fresh checkout precheck required');
  const root=mkdtempSync(join(tmpdir(),'goriq-fresh-source-'));
  try {
    const canary=join(root,'original.db');writeFileSync(canary,'PRIVATE_ORIGINAL');
    mkdirSync(join(root,'goriq-pc-route-source-42-2'));writeFileSync(join(root,'goriq-pc-route-source-42-3'),'PRIVATE_SOURCE');
    symlinkSync(join(root,'missing'),join(root,'goriq-pc-route-source-42-4'));
    for(const attempt of ['1','2','3','4','../../bad']) {
      const result=spawnSync(process.execPath,['-e',source],{encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:root,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:attempt}});
      assert.equal(result.status===0,attempt==='1',result.stderr);assert.doesNotMatch(result.stdout,/PRIVATE|goriq-fresh-source/);
    }
    assert.equal(readFileSync(canary,'utf8'),'PRIVATE_ORIGINAL');
    assert.equal(readFileSync(join(root,'goriq-pc-route-source-42-3'),'utf8'),'PRIVATE_SOURCE');
  }finally{rmSync(root,{recursive:true,force:true});}
  assert.match(workflow,/path: goriq-pc-route-source-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/clean: false/);
});
test('artifact upload is bound to successful checkout, source guard and current inspector',()=>{
  const section=workflow.split('- name: Upload sanitized runner observation')[1];assert.ok(section);
  const expression=section.match(/if: \$\{\{ (.*) \}\}/)?.[1];assert.ok(expression);
  for(const route of [true,false]) for(const precheck of ['success','failure','skipped']) for(const checkout of ['success','failure','skipped']) for(const source of ['success','failure','skipped']) for(const observation of ['success','failure','skipped']) {
    const actual=runInNewContext(expression,{inputs:{zbook_runner_only:route},steps:{source_precheck:{outcome:precheck},source_checkout:{outcome:checkout},approved_source:{outcome:source},runner_observation:{outcome:observation}}});
    assert.equal(actual,route&&[precheck,checkout,source,observation].every(s=>s==='success'));
  }
  assert.match(section,/actions\/upload-artifact@v4/);
  assert.match(section,/path: goriq-pc-route-source-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}\/\.gai-results\/zbook-runner-readonly.json/);
  assert.match(section,/if-no-files-found: error/);
});
test('fresh source reservation is atomic and refuses a symlinked workspace',()=>{
  const source=workflow.match(/run: >-\n\s+node -e '([^']+)'/)?.[1];assert.ok(source);
  const root=mkdtempSync(join(tmpdir(),'goriq-reserve-source-'));
  try {
    const invoke=workspace=>spawnSync(process.execPath,['-e',source],{encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:workspace,GITHUB_RUN_ID:'91',GITHUB_RUN_ATTEMPT:'1'}});
    const alias=join(root,'alias');symlinkSync(root,alias);
    assert.notEqual(invoke(alias).status,0,'workspace symlink must refuse');
    assert.equal(invoke(root).status,0);
    const reserved=join(root,'goriq-pc-route-source-91-1');
    writeFileSync(join(reserved,'canary'),'PRIVATE_RESERVED');
    assert.notEqual(invoke(root).status,0);assert.equal(readFileSync(join(reserved,'canary'),'utf8'),'PRIVATE_RESERVED');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('first accepted checkout admission reserves the path before checkout can run',()=>{
  const source=workflow.match(/run: >-\n\s+node -e '([^']+)'/)?.[1];assert.ok(source);
  const root=mkdtempSync(join(tmpdir(),'goriq-atomic-source-'));
  try {
    const invoke=()=>spawnSync(process.execPath,['-e',source],{encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:root,GITHUB_RUN_ID:'92',GITHUB_RUN_ATTEMPT:'1'}});
    assert.equal(invoke().status,0);
    assert.doesNotThrow(()=>writeFileSync(join(root,'goriq-pc-route-source-92-1','canary'),'PRIVATE_ATOMIC'),'accepted admission must already reserve its directory');
    assert.notEqual(invoke().status,0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('unavailable workspace refuses with a public failure class and no native path',()=>{
  const source=workflow.match(/run: >-\n\s+node -e '([^']+)'/)?.[1];assert.ok(source);
  const root=mkdtempSync(join(tmpdir(),'goriq-private-workspace-'));
  try {
    const result=spawnSync(process.execPath,['-e',source],{encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:join(root,'PRIVATE_MISSING'),GITHUB_RUN_ID:'93',GITHUB_RUN_ATTEMPT:'1'}});
    assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/PRIVATE_MISSING|goriq-private-workspace/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('precheck pins Bash and its actual shell command reserves source without legacy PowerShell quoting',()=>{
  const section=workflow.split('- name: Require unused per-run source directory')[1].split('- uses: actions/checkout')[0];
  assert.match(section,/shell: bash/);
  const command=section.match(/run: >-\n\s+(node -e '[^']+')/)?.[1];assert.ok(command);
  const root=mkdtempSync(join(tmpdir(),'goriq-bash-source-'));
  try {
    const invoke=()=>spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',command],{encoding:'utf8',env:{...process.env,GITHUB_WORKSPACE:root,GITHUB_RUN_ID:'94',GITHUB_RUN_ATTEMPT:'1'}});
    const fresh=invoke();assert.equal(fresh.status,0,fresh.stderr);
    const canary=join(root,'goriq-pc-route-source-94-1','canary');writeFileSync(canary,'PRIVATE_BASH_CANARY');
    const refused=invoke();assert.notEqual(refused.status,0);assert.equal(readFileSync(canary,'utf8'),'PRIVATE_BASH_CANARY');
    assert.doesNotMatch(fresh.stdout+refused.stderr,/PRIVATE_BASH_CANARY|goriq-bash-source/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
