import assert from 'node:assert/strict';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {createHash,createPublicKey} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

/** Trusted frozen regression. The inner model is a byte-transport fixture, not real inference. */
export async function assertLiteralTrackedRepair(){
  const runtimeRoot=process.cwd(),root=mkdtempSync(join(tmpdir(),'tracked-literal-'));
  const hash=x=>createHash('sha256').update(x).digest('hex');
  try{
    const {createTrackedRepairResidentRuntime}=await import(pathToFileURL(join(runtimeRoot,'src/orchestrator/tracked-repair-resident-runtime.ts')).href);
    const {residentDevelopmentGoalDigest}=await import(pathToFileURL(join(runtimeRoot,'src/orchestrator/resident-development-sequence.ts')).href);
    const {goalWorkStateId}=await import(pathToFileURL(join(runtimeRoot,'src/orchestrator/work-state-integration.ts')).href);
    const repo=join(root,'repo'),workspace=join(root,'candidate'),baselineWorkspace=join(root,'baseline');
    mkdirSync(repo);mkdirSync(join(repo,'scripts'));mkdirSync(join(repo,'tests'));
    const before='export const answer = 0;\n';writeFileSync(join(repo,'scripts/logic.mjs'),before);writeFileSync(join(repo,'tests/.keep'),'keep\n');
    const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
    git('init');git('config','user.name','Literal probe');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','.');git('commit','-m','base');
    const base=git('rev-parse','HEAD');git('worktree','add','--detach',workspace,base);git('worktree','add','--detach',baselineWorkspace,base);
    const goal={title:'Preserve exact source proposal bytes',successCriteria:['Source replacement is literal'],constraints:['Isolated fixture only']};
    const probe="import assert from 'node:assert/strict';import {answer} from '../scripts/logic.mjs';assert.equal(answer,42);\n",probeFile=join(root,'probe.mjs');writeFileSync(probeFile,probe);
    // RFC8032 public test vector; no private key or real signer is provisioned.
    const publicKey=createPublicKey({key:Buffer.from('302a300506032b6570032100'+'d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
    const publicKeyFile=join(root,'public.pem');writeFileSync(publicKeyFile,publicKey);
    const manifest={version:1,profile:'tracked-source-repair-v1',sequence:{version:1,goalDigest:residentDevelopmentGoalDigest(goal),taskScopeId:'issue:1948',maxRisk:'low',completionMode:'verified-local-artifact',expiresAt:new Date(Date.now()+600000).toISOString(),jobs:[{key:'literal',objective:'Preserve the proposed bytes',criterionIds:['criterion-1'],targetFiles:['scripts/logic.mjs','tests/frozen.test.mjs'],baseRevision:base}]},workspace,baselineWorkspace,targetPath:'scripts/logic.mjs',trackedFiles:[{path:'scripts/logic.mjs',beforeSha256:hash(before)}],slots:[{id:1,path:'scripts/logic.mjs',before:'0'}],probe:{file:probeFile,sha256:hash(probe),targetPath:'tests/frozen.test.mjs',expectedRedText:'0 !== 42'},model:{endpoint:'http://127.0.0.1:11435/completion',id:'fixture-model',sha256:'a'.repeat(64),nPredict:512,timeoutMs:5000},verifier:{publicKeyFile,publicKeySha256:hash(publicKey),receiptFile:join(root,'receipt.json')}};
    const file=join(root,'manifest.json'),bytes=JSON.stringify(manifest);writeFileSync(file,bytes);
    const after=JSON.stringify("literal $& $$ $` $'"),expected='export const answer = '+after+';\n';let calls=0;
    const fetchImpl=async url=>{
      if(String(url).endsWith('/apply-template'))return new globalThis.Response(JSON.stringify({prompt:'<|im_start|>assistant\n'}));
      calls++;return new globalThis.Response(JSON.stringify({model:'fixture-model',stop:true,truncated:false,stop_type:'eos',content:JSON.stringify({edits:[{slot:1,after}]})}));
    };
    const runtime=createTrackedRepairResidentRuntime({env:{GORIQ_TRACKED_REPAIR_MANIFEST_FILE:file,GORIQ_TRACKED_REPAIR_MANIFEST_SHA256:hash(bytes)},runtimeRoot,compassPath:join(root,'state/compass.sqlite'),goal,fetchImpl,resourceAdmission:async work=>work()});
    await runtime.run({goalId:goalWorkStateId(goal),goal,context:[]});
    assert.equal(calls,1);
    assert.equal(readFileSync(join(workspace,'scripts/logic.mjs'),'utf8'),expected,'Literal source edit values must retain dollar sequences exactly');
  }finally{rmSync(root,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await assertLiteralTrackedRepair();
