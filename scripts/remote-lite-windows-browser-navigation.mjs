// Some hosted Windows Chrome sessions acknowledge WebDriver /url while staying
// on the initial data:, document. Request browser navigation through the same
// driver's CDP endpoint, check its result, then verify the actual document.
async function navigationFailureState(webdriver, session, target) {
  try {
    const entries = await webdriver('POST', `/session/${session}/log`, { type: 'performance' });
    const events = entries.map(entry => JSON.parse(entry.message).message);
    const requested = events.filter(event => {
      if (event.method !== 'Network.requestWillBeSent' || event.params?.type !== 'Document') return false;
      try {
        const url = new URL(event.params.request.url);
        return url.origin === target.origin && url.pathname === target.pathname && url.search === target.search;
      } catch { return false; }
    });
    const requestIds = new Set(requested.map(event => event.params.requestId));
    const document = await webdriver('POST', `/session/${session}/execute/sync`, {
      script: `const target=new URL(arguments[0]);return {
        bootstrap:location.protocol==='data:' && document.title==='Remote Lite fixture ready' && document.readyState==='complete',
        target:location.origin===target.origin && location.pathname===target.pathname && location.search===target.search && document.readyState==='complete'
      };`, args: [target.href],
    });
    // Never return requests, URLs, headers or arbitrary protocol error strings.
    return {
      targetDocumentRequests: requested.length,
      responses: events.filter(event => event.method === 'Network.responseReceived' && event.params?.type === 'Document' && requestIds.has(event.params.requestId)).map(event => ({
        status: Number.isInteger(event.params.response?.status) ? event.params.response.status : null,
        html: event.params.response?.mimeType === 'text/html',
      })),
      bootstrapComplete: document?.bootstrap === true,
      targetComplete: document?.target === true,
      failedDocuments: events.filter(event => event.method === 'Network.loadingFailed' && event.params?.type === 'Document' && requestIds.has(event.params.requestId)).map(event => ({
        error: /^(?:net::)?(ERR_[A-Z0-9_]+)$/u.exec(event.params.errorText || '')?.[1] || 'unavailable',
        canceled: event.params.canceled === true,
        blocked: typeof event.params.blockedReason === 'string',
      })),
    };
  } catch { return { diagnosticsUnavailable: true }; }
}

export async function openWindowsFixtureTab(webdriver, session) {
  // Do not use Chrome's launch-created data:, window for native acceptance.
  // Create and select our own browsing context after the session exists.
  const tab = await webdriver('POST', `/session/${session}/window/new`, { type: 'tab' });
  if (typeof tab?.handle !== 'string' || !tab.handle) throw new Error('Windows VM fixture tab was not created');
  await webdriver('POST', `/session/${session}/window`, { handle: tab.handle });
  if (await webdriver('GET', `/session/${session}/window`) !== tab.handle) {
    throw new Error('Windows VM fixture tab was not selected');
  }
  // A selected target handle alone does not prove its startup navigation has
  // committed. Establish and verify our own inert document before the HTTP
  // fixture, so it cannot race the tab's initial document load. No time delay
  // or retry of a failed fixture navigation is used here.
  await webdriver('POST', `/session/${session}/url`, {
    url: 'data:text/html,<title>Remote Lite fixture ready</title>',
  });
  const committed = await webdriver('POST', `/session/${session}/execute/sync`, {
    script: 'return document.readyState === "complete" && document.title === "Remote Lite fixture ready";', args: [],
  });
  if (committed !== true) throw new Error('Windows VM fixture bootstrap document did not commit');
}

export async function navigateWindowsFixture(webdriver, session, destination) {
  const target = new URL(destination);
  if (destination !== 'about:blank' &&
      (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password)) {
    throw new Error('Windows VM navigation requires a loopback fixture');
  }
  // Discard earlier documents before this one navigation attempt. Diagnostics
  // still filter by exact target and request ID; no URL or ID is emitted.
  await webdriver('POST', `/session/${session}/log`, { type: 'performance' }).catch(() => {});
  const navigation = await webdriver('POST', `/session/${session}/goog/cdp/execute`, {
    cmd: 'Page.navigate', params: { url: destination },
  });
  if (typeof navigation?.frameId !== 'string' || !navigation.frameId ||
      navigation.errorText || navigation.isDownload) {
    const errorCode = /^(?:net::)?(ERR_[A-Z0-9_]+)$/u.exec(navigation?.errorText || '')?.[1] || 'unavailable';
    const state = await navigationFailureState(webdriver, session, target);
    throw new Error(`Windows VM browser navigation refused: ${errorCode} ${JSON.stringify(state)}`);
  }
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
  throw new Error('Windows VM browser did not reach the requested fixture');
}
