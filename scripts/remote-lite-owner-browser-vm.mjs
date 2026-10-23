import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { navigateWindowsFixture, openWindowsFixtureTab } from './remote-lite-windows-browser-navigation.mjs';

export async function verifyOwnerPortalBrowser({ origin, spki, ownerKey, enroll, holdNextStart, expirePending }) {
  if (!/^https:\/\/127\.0\.0\.1:\d+$/u.test(origin)) throw new Error('Disposable loopback HTTPS required');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const driver = spawn(process.env.REMOTE_LITE_CHROMEDRIVER || 'chromedriver', [`--port=${port}`, '--allowed-ips=127.0.0.1'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let driverFailure;
  driver.once('error', e => { driverFailure = e; });
  driver.stdout.resume(); driver.stderr.resume();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const webdriver = async (method, path, body) => {
    if (driverFailure) throw driverFailure;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: {'Content-Type':'application/json'}, ...(body ? { body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error('Portal WebDriver operation failed: ' + (result.value?.error || response.status));
    return result.value;
  };
  let session;
  try {
    let ready = false;
    for (let i=0;i<40;i++) { try { await webdriver('GET','/status'); ready=true; break; } catch { if (driverFailure) throw driverFailure; await pause(250); } }
    if (!ready) throw new Error('Portal browser unavailable');
    const created = await webdriver('POST','/session',{capabilities:{alwaysMatch:{browserName:'chrome','goog:loggingPrefs':{performance:'ALL'},'goog:chromeOptions':{
      args:['--headless=new', '--ignore-certificate-errors-spki-list=' + spki],
      ...(process.env.REMOTE_LITE_CHROME ? { binary: process.env.REMOTE_LITE_CHROME } : {}),
    }}}});
    session=created.sessionId;
    await openWindowsFixtureTab(webdriver, session);
    const run=(script,...args)=>webdriver('POST',`/session/${session}/execute/sync`,{script,args});
    const until=async (script, label)=>{for(let i=0;i<100;i++){if(await run(script))return;await pause(100)}throw new Error('Portal UI missing: ' + label + '; ' + await run('return document.querySelector("#error")?.textContent'))};
    // This fixture trusts only its generated certificate SPKI above. Verify the
    // actual HTTPS document through CDP; never retry an HTTPS failure or a UI action.
    await navigateWindowsFixture(webdriver, session, origin, { allowHttps: true });
    await until('return !!document.querySelector("#loginForm")?.onsubmit','module initialization');
    await run('document.querySelector("#key").value=arguments[0];document.querySelector("#loginForm").requestSubmit();return true',ownerKey);
    await until('return document.querySelector("#account").hidden===false','login');
    if(await run('return document.cookie!=="" || document.querySelector("#key").value!=="" || localStorage.length!==0 || sessionStorage.length!==0 || location.hash!=="" || location.search!==""')) throw new Error('Owner credential/cookie leaked to browser readable persistence');
    await run('document.querySelector("details").open=true; document.querySelector("#invite").click();return true');
    await until('return document.querySelector("#invitation").value.startsWith("goriqremote://")','invitation');
    const invitation = await run('return document.querySelector("#invitation").value');
    const url = new URL(invitation);
    if (url.searchParams.get('server') !== origin) throw new Error('Invitation not bound to HTTPS origin');
    const device = await enroll(url.searchParams.get('invite'));
    await run('document.querySelector("#refresh").click();return true');
    await until('return document.querySelector("#pending article")!==null','pending proof');
    if (!(await run('return document.querySelector("#pending").textContent')).includes(device.expectedFingerprint)) throw new Error('Full fingerprint absent');
    if (!(await run('return document.querySelector("#pending button").disabled'))) throw new Error('Approval lacks local fingerprint confirmation');
    await run('document.querySelector("#pending input").click();document.querySelector("#pending button").click();return true');
    await until('return document.querySelector("#devices article")!==null','approved device');
    await navigateWindowsFixture(webdriver, session, 'about:blank');
    await navigateWindowsFixture(webdriver, session, origin, { allowHttps: true });
    await until('return document.querySelector("#devices article")!==null','cookie-backed page reopen');
    const held = holdNextStart();
    await run('document.querySelector("#devices article button").click();return true');
    await Promise.race([held.started, pause(5000).then(()=>{throw new Error('Delayed start not reached')})]);
    await run('document.querySelector("#disconnect").click();return true');
    held.release();
    await pause(500);
    if (!(await run('return document.querySelector("#status").textContent')).includes('切断')) throw new Error('Late start revived a stopped UI');
    await run('document.querySelector("#devices article button").click();return true');
    await until('return !document.querySelector("#control").hidden && document.querySelector("#status").textContent.includes("許可")','pending native consent');
    await until('return document.querySelector("#sessionIdentity")?.textContent.includes("セッションID:") && document.querySelector("#status").textContent.includes("残り")','session comparison and pending deadline');
    expirePending();
    await until('return document.querySelector("#status").textContent.includes("再接続") && document.querySelector("#error").textContent.includes("接続要求を確認する")','expired consent recovery instructions');
    if ((await run('return document.querySelector("#status").textContent')).includes('未確認')) throw new Error('Server-confirmed expired session displayed an unconfirmed stop warning');
    if (!(await run('return document.querySelector("#screen").srcObject===null && [...document.querySelectorAll("#keys button")].every(b=>b.disabled)'))) throw new Error('Expired consent kept media or input available');
    await run('document.querySelector("#devices article button").click();return true');
    await until('return document.querySelector("#status").textContent.includes("残り")','fresh consent request after expiration');
    await run('document.querySelector("#logout").click();return true');
    await until('return document.querySelector("#account").hidden && !document.querySelector("#login").hidden','logout while waiting for consent');
    console.log('PASS real HTTPS Chrome owner login, invitation, real signed device enrollment, fingerprint approval, page reopen, pending connection and logout. Native media is verified separately.');
  } finally {
    if (session) await webdriver('DELETE',`/session/${session}`).catch(()=>{});
    driver.kill();
  }
}
