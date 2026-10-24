// Drive the embedded setup UI in a disposable headless Chrome. No desktop inputs.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { navigateWindowsFixture, openWindowsFixtureTab } from './remote-lite-windows-browser-navigation.mjs';

const [setupUrl] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}$/u.test(setupUrl || '')) throw new Error('Loopback setup required');
const input = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const invitation = JSON.parse((await input.next()).value).invitation;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; probe.close(); await once(probe, 'close');
const driver = spawn(process.env.REMOTE_LITE_CHROMEDRIVER || 'chromedriver', [`--port=${port}`], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
for (const stream of [driver.stdout, driver.stderr]) stream.resume();
const webdriver = async (method, path, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: {'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error('Setup WebDriver operation failed');
  return result.value;
};
let session;
try {
  let ready = false;
  for (let i=0;i<40;i++) { try { await webdriver('GET','/status'); ready=true; break; } catch { await pause(250); } }
  if (!ready) throw new Error('Setup browser unavailable');
  const created = await webdriver('POST','/session',{capabilities:{alwaysMatch:{browserName:'chrome','goog:loggingPrefs':{performance:'ALL'},'goog:chromeOptions':{
    args:['--headless=new'],
    ...(process.env.REMOTE_LITE_CHROME ? { binary: process.env.REMOTE_LITE_CHROME } : {}),
  }}}});
  session=created.sessionId;
  await openWindowsFixtureTab(webdriver, session);
  const run=(script,...args)=>webdriver('POST',`/session/${session}/execute/sync`,{script,args});
  const until=async script=>{for(let i=0;i<80;i++){if(await run(script))return;await pause(100)}throw new Error('Setup UI condition not reached')};
  // CI39877679596: the first fixed GET was canceled while the inert bootstrap
  // remained complete, before any response. Reuse only that evidenced one-shot
  // recovery; enrollment clicks and the later reopen never retry.
  const navigation = await navigateWindowsFixture(webdriver, session, setupUrl, { recoverBootstrap: true });
  process.stderr.write(`Setup bootstrap recoveries: ${navigation.recoveries}\n`);
  await until('return document.querySelector("#state")?.textContent==="未登録"');
  if (await run('return location.hash!=="" || localStorage.length!==0 || sessionStorage.length!==0')) throw new Error('Setup capability remained in URL or storage');
  await run('document.querySelector("#invite").value=arguments[0];document.querySelector("#preview").click();return true',invitation);
  await until('return !document.querySelector("#register").disabled');
  if (await run('return document.querySelector("#invite").value!==""')) throw new Error('Invitation input was not cleared');
  await run('document.querySelector("#register").click();return true');
  await until('return document.querySelector("#state").textContent.includes("所有者の承認待ち")');
  // The normal approval control must refuse before the separate owner acts.
  await run('document.querySelector("#confirm").click();return true');
  await until('return document.querySelector("#error").textContent.length>0 && !document.querySelector("#confirm").disabled');
  process.stdout.write('awaiting-owner\n');
  if ((await input.next()).value!=='approve') throw new Error('Owner approval command absent');
  await run('document.querySelector("#confirm").click();return true');
  await until('return document.querySelector("#complete").textContent.includes("登録情報を保存しました")');
  // Relaunch the setup page with the local launch capability; disk state must restore.
  // A hash-only navigation would keep the old document and falsely pass this check.
  await navigateWindowsFixture(webdriver, session, 'about:blank');
  await navigateWindowsFixture(webdriver, session, setupUrl);
  await until('return document.querySelector("#state").textContent.includes("承認済み")');
  if(await run('return location.hash!=="" || localStorage.length!==0 || sessionStorage.length!==0'))throw new Error('Relaunched setup did not clear its capability');
  process.stdout.write('approved-and-restored\n');
  if ((await input.next()).value!=='revoke') throw new Error('Owner revoke command absent');
  await run('document.querySelector("#confirm").click();return true');
  await until('return document.querySelector("#error").textContent.length>0 && !document.querySelector("#confirm").disabled');
  if(await run('return document.querySelector("#complete").textContent.length>0'))throw new Error('Stale approval success remained');
  await run('document.querySelector("#close").click();return true');
  await until('return document.querySelector("#complete").textContent.includes("設定を終了しました")');
  process.stdout.write('revoked-and-closed\n');
} finally {
  if(session)await webdriver('DELETE',`/session/${session}`).catch(()=>{});
  driver.kill();
}
