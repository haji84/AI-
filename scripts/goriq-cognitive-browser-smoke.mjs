import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const cwd=process.cwd();
const {CompassStore}=await import(pathToFileURL(join(cwd,'src/compass/store.ts')));
const {GoalControllerRuntime}=await import(pathToFileURL(join(cwd,'src/orchestrator/goal-controller-runtime.ts')));
const {CompassGoalRegistryAdapter}=await import(pathToFileURL(join(cwd,'src/orchestrator/compass-goal-controller.ts')));
// Use an already installed test runtime/browser; never download or reuse an owner profile.
const {chromium}=await import(process.env.GORIQ_BROWSER_PLAYWRIGHT ? pathToFileURL(process.env.GORIQ_BROWSER_PLAYWRIGHT).href : 'playwright');
if(!process.env.GORIQ_BROWSER_EXECUTABLE)throw Error('Specify an already installed GORIQ_BROWSER_EXECUTABLE');
const artifactRoot=await mkdtemp(join(tmpdir(),'goriq-cognitive-visual-'));
const root=await mkdtemp(join(tmpdir(),'goriq-cognitive-browser-')),data=join(root,'data');if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected temporary path');await mkdir(data);
const db=new CompassStore(join(root,'compass.db'));await new GoalControllerRuntime({registry:new CompassGoalRegistryAdapter(db)}).handle({source:'jarvis',text:'添付したテキストをそのまま保存して完成させて'});db.close();
const sample=join(root,'sample.txt'),expected='GORIQ local-only material acceptance: 42';await writeFile(sample,expected);
const port=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const proposalFixture=process.env.GORIQ_BROWSER_PROPOSAL_FIXTURE==='1';
let modelFixture;const modelPort=proposalFixture?await port():0;
const brokerPort=await port(),webPort=await port(),base='http://127.0.0.1:'+webPort,token='isolated-cognitive-ui-owner-token-not-production';
const common={...process.env,GITHUB_TOKEN:'',AI_COMPANY_GITHUB_TOKEN:'',GAI_LOCAL_MODEL_NAME:proposalFixture?'synthetic-local-browser-fixture':'',GAI_LOCAL_MODEL_ENDPOINT:proposalFixture?'http://127.0.0.1:'+modelPort:'',JARVIS_OWNER_TOKEN:token,JARVIS_COMPASS_DB_PATH:join(root,'compass.db'),JARVIS_DB_PATH:join(root,'broker.db'),GORIQ_LOCAL_DATA_ROOT:data,GORIQ_LOCAL_MATERIAL_INTAKE:'1',GORIQ_LOCAL_WORK_MANIFEST:'',GORIQ_LOCAL_OUTCOMES:'',GORIQ_HISTORY_MANIFEST:'',JARVIS_PUBLIC_BROKER_URL:'',JARVIS_WORKER_INSTALL_URL:'',JARVIS_WORKER_APK_PATH:''};
const processes=[];let browser,page;
const errors=[];
try{
if(proposalFixture){modelFixture=createHttpServer(async(req,res)=>{try{const parts=[];for await(const p of req)parts.push(p);const input=JSON.parse(Buffer.concat(parts).toString());const c=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1));const response={candidateId:c.candidates[0]?.id??null,plan:[],assessment:'Synthetic local browser fixture',hypotheses:[],expectedOutcome:'Owner-requested output',confidence:0.5,requiredEvidence:['Independent byte readback'],recoveryOptions:[],escalation:'none',...(c.purpose==='goal-draft'?{goalDraft:{successCriteria:['添付テキストを変更せず保存し、ダウンロードできる'],assumptions:['テキストが提供される'],unresolvedQuestions:[]}}:{})};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({response:JSON.stringify(response)}));}catch{res.writeHead(500);res.end();}});modelFixture.listen(modelPort,'127.0.0.1');await once(modelFixture,'listening');}
processes.push(spawn(process.execPath,['scripts/jarvis-broker.ts'],{windowsHide:true,stdio:'ignore',env:{...common,JARVIS_BROKER_HOST:'127.0.0.1',JARVIS_BROKER_PORT:String(brokerPort)}}));
processes.push(spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(webPort)],{windowsHide:true,stdio:'ignore',env:{...common,AI_COMPANY_OWNER_SECRET:'isolated-cognitive-ui-password',JARVIS_OWNER_SECRET:'isolated-cognitive-ui-password',JARVIS_BROKER_URL:'http://127.0.0.1:'+brokerPort}}));
for(let n=0;n<80;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
browser=await chromium.launch({headless:true,executablePath:process.env.GORIQ_BROWSER_EXECUTABLE});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/jarvis/login?next=%2Fjarvis%2Ftasks');
await page.locator('input[name=passcode]').fill('isolated-cognitive-ui-password');
await page.locator('form[action="/api/owner-login"] button[type=submit]').click();
await page.waitForURL('**/jarvis/tasks');
const panel=page.getByRole('region',{name:'GORIQ Cognitive Core',exact:true});
await panel.getByLabel('完了条件（1行1条件）',{exact:true}).waitFor();
const before=await page.evaluate(async()=>await(await fetch('/api/jarvis/cognitive')).json());assert.equal(before.criteria.length,0);assert.equal(await panel.getByRole('button',{name:'現在のGoalを続ける',exact:true}).isDisabled(),true);
await panel.getByRole('button',{name:'ローカルAIに完了条件を提案してもらう',exact:true}).click();
if(proposalFixture){
 const candidate=panel.getByRole('region',{name:'未検証の完了条件候補',exact:true});await candidate.waitFor();
 const unchanged=await page.evaluate(async()=>await(await fetch('/api/jarvis/cognitive')).json());assert.equal(unchanged.criteria.length,0);assert.equal(unchanged.goalDigest,before.goalDigest);assert.equal(unchanged.attempts,0);
 await candidate.getByRole('button',{name:'候補を入力欄に使う',exact:true}).click();assert.equal(await panel.getByLabel('この条件で、依頼した目標の完了を確認できます。',{exact:true}).isChecked(),false);
 assert.equal(await panel.getByLabel('完了条件（1行1条件）',{exact:true}).inputValue(),'添付テキストを変更せず保存し、ダウンロードできる');
}else{await panel.getByText('候補を作れませんでした。Goal・既存作業・ローカルAIを確認してください。完了条件は手入力できます。',{exact:true}).waitFor();}
await panel.getByLabel('完了条件（1行1条件）',{exact:true}).fill('添付したテキストが成果物にそのまま保存される');
await panel.getByLabel('この条件で、依頼した目標の完了を確認できます。',{exact:true}).check();
const adoptionResponse=page.waitForResponse(r=>r.url().endsWith('/api/jarvis/cognitive/goal')&&r.request().method()==='POST');
await panel.getByRole('button',{name:'完了条件を登録',exact:true}).click();const adoption=await adoptionResponse;assert.equal(adoption.status(),200,await adoption.text());
await panel.getByLabel('完了条件（1行1条件）',{exact:true}).waitFor({state:'detached'});
const adopted=await page.evaluate(async()=>await(await fetch('/api/jarvis/cognitive')).json());assert.equal(adopted.goalId,before.goalId);assert.notEqual(adopted.goalDigest,before.goalDigest,JSON.stringify({before,adopted}));assert.equal(adopted.goalComplete,false);assert.equal(adopted.criteria.length,1);
await panel.getByText('材料から成果物を作る',{exact:true}).waitFor();
await panel.locator('input[type=file]').setInputFiles(sample);
await panel.getByLabel('添付したテキストが成果物にそのまま保存される',{exact:true}).check();
await panel.getByLabel('選んだ完了条件は、材料を保持したこの成果物の作成・検証で確認できます。',{exact:true}).check();
await panel.getByRole('button',{name:'材料と完了条件を登録',exact:true}).click();
await panel.getByText('このGoalの材料は登録済みです。変更せず再開できます。',{exact:true}).waitFor();
await panel.getByRole('button',{name:'現在のGoalを続ける',exact:true}).click();
await panel.getByRole('button',{name:'このGoalは完了しました',exact:true}).waitFor({timeout:45000});
assert.equal(await panel.getByRole('button',{name:'成果物を取得',exact:true}).count(),1);
const downloadPromise=page.waitForEvent('download');downloadPromise.catch(()=>{});await panel.getByRole('button',{name:'成果物を取得',exact:true}).click();const download=await downloadPromise;assert.equal(await readFile(await download.path(),'utf8'),expected);
await panel.locator('summary').filter({hasText:'学習・訂正'}).click();
await panel.getByText('予測の比較は未実施です。独立した評価用の証拠が必要です。',{exact:true}).waitFor();
await panel.getByRole('button',{name:'学習候補を確認',exact:true}).click();
await panel.getByText(/モデル学習は実行していません/).waitFor();
await panel.screenshot({path:join(artifactRoot,'desktop.png')});
for(let i=0;i<3;i++){await panel.getByRole('button',{name:'状態を更新',exact:true}).click();await page.waitForLoadState('networkidle');assert.equal(await panel.getByRole('button',{name:'成果物を取得',exact:true}).count(),1);}
const state=await page.evaluate(async()=>await(await fetch('/api/jarvis/cognitive')).json());assert.equal(state.goalComplete,true);assert.equal(state.metrics.externalAiCallsPerGoal,0);
await page.reload();await panel.getByRole('button',{name:'このGoalは完了しました',exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});await panel.locator('summary').filter({hasText:'学習・訂正'}).click();await panel.screenshot({path:join(artifactRoot,'mobile.png')});
const layout=await panel.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:globalThis.innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));assert.ok(layout.left>=0&&layout.right<=layout.width+1&&layout.scrollWidth<=layout.clientWidth+1,JSON.stringify(layout));assert.deepEqual(errors,[]);
console.log(JSON.stringify({status:'PASS',browser:await browser.version(),checks:[proposalFixture?'synthetic loopback model proposal/edit/ack':'unavailable local model manual fallback','real owner login','normal Goal intake with empty criteria','explicit DoD adoption preserving identity','material upload','criterion acknowledgement','Core execute','verified exact download','learning candidate feedback','repeated refresh without duplicate controls','reload persistence','390px expanded learning containment','no page errors'],externalAiCallsPerGoal:state.metrics.externalAiCallsPerGoal,attempts:state.attempts,desktop:join(artifactRoot,'desktop.png'),mobile:join(artifactRoot,'mobile.png')}));
}catch(e){if(page){await page.screenshot({path:join(artifactRoot,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(artifactRoot,'failure.txt'),JSON.stringify({url:page.url(),errors,text:await page.locator('body').innerText().catch(()=>''),inputs:await page.locator('textarea').evaluateAll(xs=>xs.map(x=>({outer:x.outerHTML,value:x.value}))).catch(()=>[])},null,2));console.error('Failure artifacts: '+artifactRoot);}console.error(e);process.exitCode=1;}finally{await browser?.close();if(modelFixture)await new Promise(r=>modelFixture.close(r));for(const p of processes){if(p.exitCode===null&&p.signalCode===null){const done=once(p,'exit');p.kill();await done;}}await rm(root,{recursive:true,force:true});}
