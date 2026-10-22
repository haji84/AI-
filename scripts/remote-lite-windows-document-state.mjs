// Failure-only VM diagnostics. Never return URLs, fragments, tokens or page text.
export function nativeDocumentState() {
  const { document, location, performance } = globalThis;
  const body = document.body?.textContent?.trim() || '';
  const refusal = ['host denied', 'origin denied', 'cookies denied'].find(value => body === value) || null;
  const code = document.querySelector('#main-frame-error .error-code')?.textContent?.trim() || '';
  const navigation = performance.getEntriesByType('navigation')[0];
  return {
    ready: document.readyState,
    screen: !!document.querySelector('#screen'),
    canvas: !!document.querySelector('#sourceCanvas'),
    bridge: !!globalThis.remoteLiteBridge,
    httpDocument: location.protocol === 'http:',
    blankDocument: location.href === 'about:blank' || location.href === 'data:,',
    browserError: document.documentURI.startsWith('chrome-error:'),
    browserErrorCode: /^ERR_[A-Z_]+$/u.test(code) ? code : null,
    responseStatus: Number.isInteger(navigation?.responseStatus) ? navigation.responseStatus : null,
    bodyLength: body.length,
    refusal,
  };
}
