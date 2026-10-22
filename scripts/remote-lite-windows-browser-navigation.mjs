// Some hosted Windows Chrome sessions acknowledge WebDriver /url while staying
// on the initial data:, document. Navigate once through the active renderer and
// verify the destination before any native media/input assertions begin.
export async function openWindowsFixtureTab(webdriver, session) {
  // Do not use Chrome's launch-created data:, window for native acceptance.
  // Create and select our own browsing context after the session exists.
  const tab = await webdriver('POST', `/session/${session}/window/new`, { type: 'tab' });
  if (typeof tab?.handle !== 'string' || !tab.handle) throw new Error('Windows VM fixture tab was not created');
  await webdriver('POST', `/session/${session}/window`, { handle: tab.handle });
  if (await webdriver('GET', `/session/${session}/window`) !== tab.handle) {
    throw new Error('Windows VM fixture tab was not selected');
  }
}

export async function navigateWindowsFixture(webdriver, session, destination) {
  const target = new URL(destination);
  if (destination !== 'about:blank' &&
      (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password)) {
    throw new Error('Windows VM navigation requires a loopback fixture');
  }
  await webdriver('POST', `/session/${session}/execute/sync`, {
    script: 'globalThis.location.replace(arguments[0]); return true;', args: [destination],
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    const arrived = await webdriver('POST', `/session/${session}/execute/sync`, {
      script: `const target=new URL(arguments[0]);return document.readyState==='complete' &&
        location.origin===target.origin && location.pathname===target.pathname && location.search===target.search;`,
      args: [destination],
    });
    if (arrived === true) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Never include the launch URL or page body in diagnostics.
  throw new Error('Windows VM renderer did not reach the requested fixture');
}
