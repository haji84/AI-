import fs from 'node:fs';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';import {createServer} from 'node:net';import {once} from 'node:events';import path from 'node:path';
// Optional local QA capability; absent browser tooling fails visibly, never counts as a pass.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve('.jarvis/verification-1205-ui');fs.mkdirSync(out,{recursive:true});
const free=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const bp=await free(),wp=await free(),secret=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');
const env={...process.env,NODE_ENV:'development',GITHUB_TOKEN:'',JARVIS_OWNER_SECRET:secret,JARVIS_OWNER_TOKEN:token,JARVIS_BROKER_HOST:'127.0.0.1',JARVIS_BROKER_PORT:String(bp),JARVIS_BROKER_URL:'http://127.0.0.1:'+bp,JARVIS_DB_PATH:path.join(out,'ui-'+Date.now()+'.sqlite'),JARVIS_COMPASS_DB_PATH:path.join(out,'compass-'+Date.now()+'.sqlite'),JARVIS_PUBLIC_BROKER_URL:'',JARVIS_WORKER_INSTALL_URL:'',JARVIS_WORKER_APK_PATH:''};
const children=[],handles=[];let browser;
function launch(args,name){const fd=fs.openSync(path.join(out,name+'.log'),'w');handles.push(fd);const c=spawn(process.execPath,args,{cwd:process.cwd(),windowsHide:true,env,stdio:['ignore',fd,fd]});children.push(c);return c;}
const ready=async(url,child)=>{for(let n=0;n<180;n++){if(child.exitCode!==null)throw Error('test server exited');try{const r=await fetch(url,{signal:AbortSignal.timeout(1200)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('test server timeout');};
const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 const broker=launch(['scripts/jarvis-broker.ts'],'broker');await ready('http://127.0.0.1:'+bp+'/health',broker);
 const front=launch(['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(wp)],'next');const base='http://127.0.0.1:'+wp;await ready(base+'/api/health',front);
 browser=await chromium.launch({headless:true,...(process.env.JARVIS_TEST_BROWSER_CHANNEL?{channel:process.env.JARVIS_TEST_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/jarvis/tasks');await page.getByRole('heading',{name:'仕様・要望'}).waitFor();
 await page.getByText('オーナー認証が必要です。',{exact:true}).waitFor();console.log('Browser initial load/auth gate PASS');
 const login=await context.request.post(base+'/api/owner-login',{form:{passcode:secret,next:'/jarvis/tasks'},headers:{accept:'application/json'}});assert(login.ok(),'fixture login');
 await page.reload();await page.getByText('保存された要求はまだありません。').waitFor();
 const text='通知音を変更できる機能を追加して';
 await page.getByLabel('追加・変更したいこと',{exact:true}).fill(text);
 await page.route('**/api/jarvis/work',async route=>{await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'JARVISに伝える',exact:true}).click();
 await page.getByText('依頼を保存できませんでした。内容を残しているので再送できます。').waitFor();
 await page.unroute('**/api/jarvis/work');
 await page.getByRole('button',{name:'JARVISに伝える',exact:true}).click();
 const record=page.locator('.requirements-record').filter({has:page.getByRole('heading',{name:text,exact:true})});
 await record.waitFor();assert(await page.locator('.requirements-record').count()===1,'retry must not duplicate persisted receipt');assert(await record.getByText('採用済み・反映待ち',{exact:true}).isVisible(),'adopted receipt visible');
 await record.getByLabel('対応する仕様',{exact:true}).selectOption('new');await record.getByRole('button',{name:'反映内容を確認'}).click();
 await page.getByRole('region',{name:'仕様の反映内容'}).waitFor();await page.getByText('要件ID: OWN-001',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'この内容で仕様に反映する'}).isDisabled(),'no fake publication without credential');
 await page.evaluate(()=>globalThis.window.scrollTo(0,0));await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 await page.getByLabel('追加・変更したいこと',{exact:true}).fill('例えば別の通知機能を追加してという依頼');
 await page.getByRole('button',{name:'JARVISに伝える',exact:true}).click();
 const idea=page.locator('.requirements-record').filter({has:page.getByRole('heading',{name:'例えば別の通知機能を追加してという依頼',exact:true})});
 await idea.getByText('検討メモ',{exact:true}).waitFor();
 await idea.getByRole('button',{name:'この案を採用する'}).click();
 await page.getByRole('button',{name:'JARVISに伝える',exact:true}).click();
 await page.getByText('選択した保存済みの案を採用します。',{exact:true}).first().waitFor();
 await page.waitForFunction(()=>globalThis.document.querySelector('.requirements-input button')?.textContent==='JARVISに伝える');
 assert(await page.locator('.requirements-record').count()===3,'adoption source and receipt retained');assert(await page.getByRole('button',{name:'この案を採用する'}).count()===0,'adopted source cannot be adopted again');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>globalThis.window.scrollTo(0,0));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.window.innerWidth+2),'mobile horizontal overflow');
 assert(errors.length===0,'browser page errors: '+errors.join(';'));
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'PASS',timestamp:new Date().toISOString(),checks:['real isolated Broker + browser owner auth','natural adoption persisted','lost response retry is idempotent','adopted source marked used','new-ID preview','publication-disabled without capability','example kept IDEA','selected saved-reference adoption','desktop/mobile no horizontal overflow','no browser page errors'],pageErrors:errors,physical:false},null,2));
 console.log('Browser workflow PASS desktop1440/mobile390; evidence '+out);
}catch(e){console.error(e);process.exitCode=1;}
finally{await browser?.close();for(const c of children.reverse()){if(c.exitCode===null){const exited=once(c,'exit');c.kill();await Promise.race([exited,new Promise(r=>setTimeout(r,4000))]);}}for(const fd of handles)fs.closeSync(fd);}
