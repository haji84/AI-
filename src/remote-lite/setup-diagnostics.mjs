/**
 * Single-front-door setup/status decision engine for the future friend edition.
 * A status may be displayed as READY only when *independent runtime evidence*
 * establishes that the relevant capture/control method is actually usable.
 */
const diagnostic = {
  HOST_NOT_INSTALLED: ['Windows側のアプリをインストール', 'Windows用GORIQ Remoteを導入してください'],
  HOST_OFFLINE: ['PCとの接続待ち', 'PCの電源・ネットワーク・アプリの稼働状態を確認してください'],
  AUTH_REQUIRED: ['本人確認が必要', '自分のアカウントでログインしてください'],
  REGISTRATION_REQUIRED: ['端末を登録', '端末側のQR読み取りと所有者の承認が必要です'],
  PERMISSION_REQUIRED: ['端末の操作権限が必要', '端末側で必要な画面共有・操作権限を許可してください'],
  SIGNALING_OFFLINE: ['接続サービスに到達できません', '通信状況を確認し、再接続を選択してください'],
  RELAY_UNAVAILABLE: ['直接接続できません', '中継サーバーが利用できません。利用者側のポート開放は不要です'],
  SCREEN_CONSENT_REQUIRED: ['画面共有の許可が必要', '操作される端末でOSの画面共有確認を許可してください'],
  DEVICE_BUSY: ['他の操作が実行中です', '既存の操作セッションを終了してから接続してください'],
  NOT_SUPPORTED: ['この端末では利用できません', 'OSバージョンと対応機能を確認してください'],
  READY: ['手動遠隔操作できます', '端末を選んで「接続」を押してください'],
};
export const remoteLiteDiagnostic = code => {
  const [title, explanation] = diagnostic[code] ?? ['状態を確認できません', '接続診断を再実行してください'];
  return { code, title, explanation, success: code === 'READY' };
};
const isBool = v => v === true;
/**
 * Runtime-produced flags only. This function makes no network requests, opens
 * no Windows screen and cannot grant OS permission. Unknown is NEVER success.
 */
export function diagnoseRemoteLite({
  hostInstalled, hostOnline, ownerAuthenticated, deviceRegistered,
  devicePermissionGranted, signalingReachable, directPeerReachable,
  relayReachable, localScreenConsent, deviceBusy, nativeSupported,
  realFrameReceived, inputAcknowledged,
} = {}) {
  const fail = code => remoteLiteDiagnostic(code);
  if (!isBool(hostInstalled)) return fail('HOST_NOT_INSTALLED');
  if (!isBool(hostOnline)) return fail('HOST_OFFLINE');
  if (!isBool(ownerAuthenticated)) return fail('AUTH_REQUIRED');
  if (!isBool(deviceRegistered)) return fail('REGISTRATION_REQUIRED');
  if (!isBool(nativeSupported)) return fail('NOT_SUPPORTED');
  if (!isBool(devicePermissionGranted)) return fail('PERMISSION_REQUIRED');
  if (deviceBusy !== false) return fail('DEVICE_BUSY');
  if (!isBool(signalingReachable)) return fail('SIGNALING_OFFLINE');
  if (!isBool(directPeerReachable) && !isBool(relayReachable)) return fail('RELAY_UNAVAILABLE');
  if (!isBool(localScreenConsent)) return fail('SCREEN_CONSENT_REQUIRED');
  if (!isBool(realFrameReceived) || !isBool(inputAcknowledged)) {
    return { ...fail('HOST_OFFLINE'), code: 'E2E_NOT_VERIFIED',
      title: '映像・入力の確認待ち', explanation: '実際の画面と操作結果が確認できるまで利用可能とは表示しません' };
  }
  return fail('READY');
}
export const setupSteps = Object.freeze([
  { id:'install',title:'GORIQ Remoteをインストール' },
  { id:'sign-in',title:'本人確認' },
  { id:'pair',title:'端末を追加・QR登録' },
  { id:'permission',title:'端末の画面・操作権限を確認' },
  { id:'connect',title:'接続診断' },
  { id:'verify',title:'画面表示・手動入力を実機テスト' },
]);
