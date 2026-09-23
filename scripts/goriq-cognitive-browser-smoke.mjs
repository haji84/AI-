import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const cwd=process.cwd();
const {CompassStore}=await import(pathToFileURL(join(cwd,'src/compass/store.ts')));
// Use an already installed test runtime/browser; never download or reuse an owner profile.
const {chromium}=await import(process.env.GORIQ_BROWSER_PLAYWRIGHT ? pathToFileURL(process.env.GORIQ_BROWSER_PLAYWRIGHT).href : 'playwright');
if(!process.env.GORIQ_BROWSER_EXECUTABLE)throw Error('Specify an already installed GORIQ_BROWSER_EXECUTABLE');
const artifactRoot=await mkdtemp(join(tmpdir(),'goriq-cognitive-visual-'));
const root=await mkdtemp(join(tmpdir(),'goriq-cognitive-browser-')),data=join(root,'data');if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected temporary path');await mkdir(data);
const db=new CompassStore(join(root,'compass.db'));db.setGoal({title:'添付材料をそのまま保存する',successCriteria:['添付したテキストが成果物にそのまま保存される']});db.close();
const sample=join(root,'sample.txt'),expected='GORIQ local-only material acceptance: 42';await writeFile(sample,expected);
const port=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const brokerPort=await port(),webPort=await port(),base='http://127.0.0.1:'+webPort,token='isolated-cognitive-ui-owner-token-not-production';
const common={...process.env,GITHUB_TOKEN:'',AI_COMPANY_GITHUB_TOKEN:'',GAI_LOCAL_MODEL_NAME:'',JARVIS_OWNER_TOKEN:token,JARVIS_COMPASS_DB_PATH:join(root,'compass.db'),JARVIS_DB_PATH:join(root,'broker.db'),GORIQ_LOCAL_DATA_ROOT:data,GORIQ_LOCAL_MATERIAL_INTAKE:'1',GORIQ_LOCAL_WORK_MANIFEST:'',GORIQ_LOCAL_OUTCOMES:'',GORIQ_HISTORY_MANIFEST:'',JARVIS_PUBLIC_BROKER_URL:'',JARVIS_WORKER_INSTALL_URL:'',JARVIS_WORKER_APK_PATH:''};
const processes=[];let browser;
const errors=[];
try{
processes.push(spawn(process.execPath,['scripts/jarvis-broker.ts'],{windowsHide:true,stdio:'ignore',env:{...common,JARVIS_BROKER_HOST:'127.0.0.1',JARVIS_BROKER_PORT:String(brokerPort)}}));
processes.push(spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(webPort)],{windowsHide:true,stdio:'ignore',env:{...common,AI_COMPANY_OWNER_SECRET:'isolated-cognitive-ui-password',JARVIS_OWNER_SECRET:'isolated-cognitive-ui-password',JARVIS_BROKER_URL:'http://127.0.0.1:'+brokerPort}}));
for(let n=0;n<80;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
browser=await chromium.launch({headless:true,executablePath:process.env.GORIQ_BROWSER_EXECUTABLE});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/jarvis/login?next=%2Fjarvis%2Ftasks');
await page.locator('input[name=passcode]').fill('isolated-cognitive-ui-password');
await page.locator('form[action="/api/owner-login"] button[type=submit]').click();
await page.waitForURL('**/jarvis/tasks');
const panel=page.getByRole('region',{name:'GORIQ Cognitive Core',exact:true});
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
await panel.getByRole('button',{name:'学習候補を確認',exact:true}).click();
await panel.getByText(/モデル学習は実行していません/).waitFor();
await panel.screenshot({path:join(artifactRoot,'desktop.png')});
for(let i=0;i<3;i++){await panel.getByRole('button',{name:'状態を更新',exact:true}).click();await page.waitForLoadState('networkidle');assert.equal(await panel.getByRole('button',{name:'成果物を取得',exact:true}).count(),1);}
const state=await page.evaluate(async()=>await(await fetch('/api/jarvis/cognitive')).json());assert.equal(state.goalComplete,true);assert.equal(state.metrics.externalAiCallsPerGoal,0);
await page.reload();await panel.getByRole('button',{name:'このGoalは完了しました',exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});await panel.locator('summary').filter({hasText:'学習・訂正'}).click();await panel.screenshot({path:join(artifactRoot,'mobile.png')});
const layout=await panel.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:globalThis.innerWidth,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));assert.ok(layout.left>=0&&layout.right<=layout.width+1&&layout.scrollWidth<=layout.clientWidth+1,JSON.stringify(layout));assert.deepEqual(errors,[]);
console.log(JSON.stringify({status:'PASS',browser:await browser.version(),checks:['real owner login','material upload','criterion acknowledgement','Core execute','verified exact download','learning candidate feedback','repeated refresh without duplicate controls','reload persistence','390px expanded learning containment','no page errors'],externalAiCallsPerGoal:state.metrics.externalAiCallsPerGoal,attempts:state.attempts,desktop:join(artifactRoot,'desktop.png'),mobile:join(artifactRoot,'mobile.png')}));
}catch(e){console.error(e);process.exitCode=1;}finally{await browser?.close();for(const p of processes){if(p.exitCode===null&&p.signalCode===null){const done=once(p,'exit');p.kill();await done;}}await rm(root,{recursive:true,force:true});}
