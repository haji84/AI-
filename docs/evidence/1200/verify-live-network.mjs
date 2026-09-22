import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const cwd=process.cwd(); const root=mkdtempSync(join(tmpdir(),'jarvis-research-live-'));
const url='https://registry.npmjs.org/-/package/typescript/dist-tags';
const runs=[];
for(const [label,expected] of [['match','7.0.2'],['conflict','definitely-not-typescript']]){
 const state=join(root,label);
 const command={source:'codex',command:'Verify the public package version only',plan:{kind:'delegate',description:'Verify package identity from exact public source',delegation:{target:'research',factCheck:{claims:[{id:'package-version',required:true,value:expected,jsonField:'latest',sources:[{url,sourceClass:'primary_original'}]}]}}}};
 const child=spawnSync(process.execPath,['scripts/autonomy-cloud-run.ts','--mode=run','--max-cycles=1'],{cwd,encoding:'utf8',timeout:45000,windowsHide:true,env:{...process.env,GITHUB_TOKEN:'',JARVIS_BROKER_URL:'',JARVIS_OWNER_TOKEN:'',RESEARCH_WORKER_ENDPOINTS_JSON:'',AUTONOMY_APPROVAL_KEY:'',AUTONOMY_COMMAND_JSON:JSON.stringify(command),AUTONOMY_STATE_DIR:state,COMPASS_DB_PATH:join(state,'compass.db'),AUTONOMY_SUMMARY_PATH:join(state,'summary.json'),AUTONOMY_FEEDBACK_PATH:join(state,'feedback.json'),JARVIS_RESEARCH_SOURCE_POLICY_JSON:JSON.stringify({version:1,sources:[{url,sourceClass:'primary_original',fields:['latest']}]})}});
 let result;try{const report=JSON.parse(readFileSync(join(state,'summary.json'),'utf8')); const cycle=report.report?.cycles?.[0];result={label,processExit:child.status,stopReason:report.report?.stopReason,resultOk:cycle?.result?.ok,verifierOk:cycle?.verification?.ok,evidence:cycle?.result?.evidence};}catch{result={label,processExit:child.status,error:child.error?.message||'summary unavailable',stderr:child.stderr?.slice(-1200)};}
 runs.push(result);
}
const report={kind:'software-network-integration',physical:false,productionActivated:false,stateRoot:root,runs};
writeFileSync(join(tmpdir(),'jarvis-1200-live-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(runs[0]?.resultOk!==true || runs[0]?.verifierOk!==true || runs[1]?.resultOk!==false)process.exitCode=1;
