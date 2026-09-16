import { createHash } from "node:crypto";
import { WORKER_APK } from "../../jarvis/invitation-link.ts";

const script = `
try {
  const p = new URLSearchParams(location.hash.slice(1));
  const broker = new URL(p.get('broker') || '');
  const token = p.get('token') || '';
  const ip = broker.hostname.split('.').map(Number);
  const privateIP = /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(broker.hostname) && ip.every(n => n >= 0 && n <= 255) &&
    (ip[0] === 10 || ip[0] === 192 && ip[1] === 168 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31);
  if (!privateIP || broker.protocol !== 'https:' || broker.username || broker.password || broker.pathname !== '/' || broker.search || broker.hash || !/^ji_[A-Za-z0-9_-]{43}$/.test(token)) throw Error();
  const params = new URLSearchParams({broker: broker.origin, token}).toString();
  document.getElementById('register').href = 'intent://enroll?' + params + '#Intent;scheme=jarvis;package=ai.jarvis.worker;end';
  document.getElementById('register').hidden = false;
  document.getElementById('status').textContent = '家のWi-Fiへ接続し、インストール後にこのページへ戻って「登録する」を押してください。USBやZBook側の受付操作は不要です。';
} catch { document.getElementById('status').textContent = '招待情報がありません。所有者から届いた専用リンク全体を開いてください。'; }
`;

export function GET() {
  const hash = createHash("sha256").update(script).digest("base64");
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>JARVIS Android登録</title><style>body{font-family:system-ui;background:#071724;color:#eef6ff;padding:24px;line-height:1.8}main{max-width:600px;margin:auto}a{display:block;background:#126e85;color:white;padding:16px;margin:20px 0;border-radius:12px;text-align:center}a[hidden]{display:none}</style></head><body><main><h1>JARVIS Android登録</h1><p id="status">招待情報を確認しています。</p><a href="${WORKER_APK}" rel="noreferrer">1. Workerをインストール・更新</a><a id="register" hidden>2. Workerを開いて登録する</a><p>このリンクを知る人は端末を登録できます。公開しないでください。操作に必要なAndroidの初回権限は端末上で有効にしてください。</p><p>アプリを入れただけでは登録は完了しません。「登録する」を押し、Workerの登録完了表示を確認してください。</p></main><script>${script}</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` },
  });
}
