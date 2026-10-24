import { BrowserManualPeer } from './browser-webrtc.mjs';
const doc = globalThis.document;
const el = id => doc.getElementById(id);
let csrf = '', current = null, actionBusy = false, operationEpoch = 0;
const delay = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));
const api = async (path, payload = {}, keepalive = false) => {
  const response = await globalThis.fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive,
    headers: { 'Content-Type': 'application/json', 'X-Remote-CSRF': csrf }, body: JSON.stringify(payload), signal: globalThis.AbortSignal.timeout(8000) });
  const data = await response.json();
  if (!response.ok || data.ok !== true) { const e = new Error(data.code || 'CONNECTION_FAILED'); e.code = data.code; throw e; }
  return data.result;
};
const showError = e => { el('error').textContent = e?.code === 'SESSION_NOT_FOUND_OR_EXPIRED'
  ? '接続要求の期限が切れたか、接続が終了しました。端末一覧で「接続」を押してください。Androidでは「接続要求を確認する」→「このセッションへ画面を共有する」→OSの許可を続けて行ってください。Windowsではホストで新しい接続要求を確認・許可し、「遠隔共有を開始」を押してください。'
  : '処理を確認できませんでした。接続・ログイン・端末側の許可を確認してください。' + (e?.code ? ' (' + e.code + ')' : ''); };
const pendingMessage = expiresAt => '端末側の許可を待っています（残り ' + Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) + ' 秒）。この画面を開いたまま端末側で許可してください。';
const action = fn => async event => {
  event?.preventDefault(); if (actionBusy) return;
  actionBusy = true; el('error').textContent = '';
  try { await fn(); } catch (e) { showError(e); } finally { actionBusy = false; }
};
const setLogin = info => {
  csrf = info.csrf; el('login').hidden = true; el('account').hidden = false;
  el('owner').textContent = '所有者: ' + info.ownerId;
};
function button(text, fn) { const b = doc.createElement('button'); b.textContent = text; b.onclick = action(fn); return b; }
function line(text) { const p = doc.createElement('p'); p.textContent = text; return p; }
async function refresh() {
  const result = await api('/api/devices');
  el('devices').replaceChildren(); el('pending').replaceChildren();
  for (const d of result.registered) {
    const card = doc.createElement('article'); card.dataset.device = d.deviceId;
    card.append(line(d.deviceId), button('接続', () => connect(d.deviceId)), button('登録を解除', async () => {
      if (!globalThis.confirm('この端末の登録を解除します。再利用には新しい招待と端末側の確認が必要です。')) return;
      await api('/api/revoke', { deviceId: d.deviceId });
      if (current?.deviceId === d.deviceId) await stop('登録を解除しました');
      await refresh();
    })); el('devices').append(card);
  }
  if (!result.registered.length) el('devices').append(line('登録済みの端末はありません。新しい端末を追加してください。'));
  for (const d of result.pending) {
    const card = doc.createElement('article');
    const check = doc.createElement('input'); check.type = 'checkbox';
    const label = doc.createElement('label'); label.append(check, doc.createTextNode('端末画面の指紋と一致しています'));
    const approve = button('この端末を承認', async () => {
      if (!check.checked) return;
      await api('/api/approve', { requestId: d.requestId, expectedFingerprint: d.fingerprint }); await refresh();
    }); approve.disabled = true; check.onchange = () => { approve.disabled = !check.checked; };
    card.append(line(d.deviceId), line('申請: ' + d.requestId), line('指紋: ' + d.fingerprint), label, approve);
    el('pending').append(card);
  }
  if (!result.pending.length) el('pending').append(line('承認待ちの申請はありません。端末で登録後に「更新」を押してください。'));
}
async function stop(message = '切断しました', keepalive = false) {
  const epoch = ++operationEpoch;
  const old = current; current = null;
  globalThis.clearInterval(old?.monitor);
  old?.peer?.close('owner-ended');
  el('screen').srcObject = null; el('status').textContent = message;
  el('keys').querySelectorAll('button').forEach(b => { b.disabled = true; });
  if (old) {
    try { await api('/api/viewer/end', { sessionId: old.sessionId }, keepalive); }
    catch (e) { if (e?.code !== 'SESSION_NOT_FOUND_OR_EXPIRED' && epoch === operationEpoch) el('status').textContent = message + '。端末への停止通知は未確認です。端末側でも停止を確認してください。'; }
  }
}
async function connect(deviceId) {
  const epoch = operationEpoch + 1;
  await stop();
  if (epoch !== operationEpoch || doc.visibilityState !== 'visible') return;
  el('control').hidden = false; el('status').textContent = '接続要求を送信しています';
  const session = await api('/api/start', { deviceId });
  if (epoch !== operationEpoch || doc.visibilityState !== 'visible') {
    try { await api('/api/viewer/end', { sessionId: session.sessionId }, true); }
    catch { if (epoch === operationEpoch) el('status').textContent = '停止通知は未確認です。端末側でも停止を確認してください。'; }
    return;
  }
  const s = { ...session, peer: null, cursor: 0, lastFrame: 0, totalFrames: 0, began: 0 };
  current = s; el('control').hidden = false; el('target').textContent = '接続先: ' + deviceId;
  el('platform').value = '';
  el('status').textContent = pendingMessage(s.expiresAt); el('ack').textContent = '入力確認: 0';
  el('sessionIdentity').textContent = 'セッションID: ' + s.sessionId + '（端末側の表示と照合してください）';
  el('mode').textContent = session.connectionMode === 'direct-only'
    ? '直接接続モード。中継が必要な回線では接続できません。'
    : session.connectionMode === 'stun-approved-provider'
      ? 'STUNによる直接接続。中継が必要な回線では接続できません。' : '中継対応の接続設定';
  el('control').scrollIntoView({ behavior: 'smooth' });
  const post = (path, extra = {}) => api('/api/viewer/' + path, { sessionId: s.sessionId, ...extra });
  const video = el('screen');
  s.peer = new BrowserManualPeer({ role: 'viewer', iceServers: session.iceServers, waitForManualAck: true,
    canSendManual: () => current === s && doc.visibilityState === 'visible' && s.lastFrame > 0 &&
      globalThis.performance.now() - s.lastFrame < 2000,
    rtcFactory: options => new globalThis.RTCPeerConnection(options),
    sendSignal: signal => post('signal', { signal }),
    onStream: stream => { if (current === s) { video.srcObject = stream; video.play().catch(() => { if (current === s) void stop('動画の再生を開始できません'); }); } },
    onState: state => { if (current === s && s.peer?.closed) void stop('通信が終了しました (' + state + ')'); },
    onManualAcknowledged: seq => { if (current === s) el('ack').textContent = '入力確認: ' + seq; },
  });
  const frame = () => {
    if (current !== s) return;
    s.lastFrame = globalThis.performance.now(); s.totalFrames++;
    video.requestVideoFrameCallback(frame);
  };
  if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(frame);
  // This watchdog is independent of an in-flight HTTPS request. A stale frame
  // must lose its LIVE label/input immediately, even while signaling is stalled.
  s.monitor = globalThis.setInterval(() => {
    if (current !== s || !s.began) return;
    const now = globalThis.performance.now();
    const fresh = s.lastFrame > 0 && now - s.lastFrame < 2000 && s.peer.connected;
    el('status').textContent = fresh ? 'LIVE — 映像を受信中' : '映像の更新待ち — 操作は停止中';
    el('keys').querySelectorAll('button').forEach(b => { b.disabled = !fresh || b.dataset.platform !== el('platform').value; });
    if ((!s.lastFrame && now - s.began > 45000) || (s.lastFrame && now - s.lastFrame > 4000)) void stop('映像の更新を確認できないため停止しました');
  }, 250);
  void (async () => { try {
    // Pending is intentional: native local consent must succeed before signaling.
    while (current === s) {
      const status = await post('status');
      if (current !== s) return;
      if (status.status === 'active') break;
      if (status.status !== 'pending') throw new Error('SESSION_NOT_ACTIVE');
      el('status').textContent = pendingMessage(status.expiresAt);
      await delay(400);
    }
    if (current !== s) return;
    s.began = globalThis.performance.now();
    await s.peer.startViewer();
    while (current === s && !s.peer.closed) {
      const batch = await post('poll', { ack: s.cursor });
      if (current !== s) return;
      if (!Number.isSafeInteger(batch.cursor) || batch.cursor < s.cursor || batch.cursor > s.cursor + 1 ||
        !Array.isArray(batch.signals) || batch.signals.length > 1 || (batch.signals.length === 1) !== (batch.cursor === s.cursor + 1)) throw new Error('SIGNAL_BATCH_INVALID');
      for (const signal of batch.signals) await s.peer.receiveSignal(signal);
      s.cursor = batch.cursor;
      const status = await post('status');
      if (current !== s) return;
      if (status.status !== 'active') throw new Error('SESSION_NOT_ACTIVE');
      await delay(200);
    }
  } catch (e) { if (current === s) { showError(e); await stop(e?.code === 'SESSION_NOT_FOUND_OR_EXPIRED'
    ? '接続要求は終了しました。端末一覧の「接続」から再接続してください。' : '接続を確認できないため停止しました'); } } })();
}
function send(command) {
  const s = current;
  if (!s?.peer?.connected || !s.lastFrame || globalThis.performance.now() - s.lastFrame >= 2000) return;
  try { s.peer.sendManual(command); } catch (e) { showError(e); void stop('操作の送信を確認できません'); }
}
function point(event) {
  const video = el('screen'), rect = video.getBoundingClientRect();
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const width = video.videoWidth * scale, height = video.videoHeight * scale;
  const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
let gesture = null;
el('screen').onpointerdown = e => { if (e.isPrimary && e.button === 0) { const p = point(e); if (p) { gesture = { ...p, id: e.pointerId, at: globalThis.performance.now(), session: current }; el('screen').setPointerCapture(e.pointerId); } } };
el('screen').onpointercancel = () => { gesture = null; };
el('screen').onpointerup = e => {
  const start = gesture; gesture = null;
  if (!start || start.id !== e.pointerId || start.session !== current) return;
  const end = point(e); if (!end) return;
  if (Math.hypot(start.x - end.x, start.y - end.y) < .015) send({ action: 'tap', ...end });
  else send({ action: 'swipe', x1: start.x, y1: start.y, x2: end.x, y2: end.y, durationMs: Math.max(100, Math.min(1000, Math.round(globalThis.performance.now() - start.at))) });
};
el('keys').querySelectorAll('button').forEach(b => { b.disabled = true; b.onclick = () => { if (b.dataset.platform === el('platform').value) send({ action: 'key', key: b.dataset.key }); }; });
el('platform').onchange = () => { el('keys').querySelectorAll('button').forEach(b => { b.disabled = true; }); };
el('loginForm').onsubmit = action(async () => {
  const key = el('key').value.trim(); el('key').value = '';
  setLogin(await api('/api/login', { key })); await refresh();
});
el('refresh').onclick = action(refresh);
el('invite').onclick = action(async () => {
  const result = await api('/api/invite'); el('invitation').value = result.invitation;
  el('inviteExpiry').textContent = '有効期限: ' + new Date(result.expiresAt).toLocaleTimeString();
});
el('copy').onclick = action(async () => { if (el('invitation').value) { await globalThis.navigator.clipboard.writeText(el('invitation').value); el('message').textContent = '招待をコピーしました'; } });
el('disconnect').onclick = () => { void stop(); };
el('logout').onclick = action(async () => {
  await stop(); await api('/api/logout'); csrf = ''; el('account').hidden = true; el('control').hidden = true; el('login').hidden = false;
  el('invitation').value = ''; el('devices').replaceChildren(); el('pending').replaceChildren(); el('message').textContent = 'ログアウトしました';
});
doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') void stop('画面が非表示になったため停止しました', true); });
globalThis.addEventListener('pagehide', () => { void stop('画面を閉じたため停止しました', true); });
api('/api/session').then(async info => { setLogin(info); await refresh(); }).catch(() => { /* Normal signed-out entry. */ });
