import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.JARVIS_COMMANDER_PORT || 8790);
const broker = process.env.JARVIS_COMMANDER_BROKER?.trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const accessKey = process.env.JARVIS_COMMANDER_KEY?.trim() || "";
if (!ownerToken || !accessKey) throw new Error("JARVIS_OWNER_TOKEN and JARVIS_COMMANDER_KEY are required");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function keyFrom(request: IncomingMessage, url: URL) {
  const header = request.headers["x-jarvis-commander-key"];
  return typeof header === "string" ? header : url.searchParams.get("key") || "";
}
function authorized(request: IncomingMessage, url: URL) { return safeEqual(keyFrom(request, url), accessKey); }
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}
function html(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" });
  response.end(body);
}
async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += b.length; if (bytes > 200_000) throw new Error("body too large"); chunks.push(b); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
async function brokerFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${broker}${path}`, { ...init, headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!response.ok) throw new Error(typeof body === "object" && body && "message" in body ? String((body as {message?:unknown}).message) : `Broker HTTP ${response.status}`);
  return body;
}

function page(key: string) {
  const k = JSON.stringify(key).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:900px;margin:auto;padding:24px}.hero{padding:22px;border:1px solid #24445b;border-radius:22px;background:linear-gradient(145deg,#102637,#071019);box-shadow:0 18px 50px #0008}h1{margin:0;font-size:28px;letter-spacing:.06em}.sub{color:#95adc0;margin:8px 0 0}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.pill{background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;font-size:13px}.panel{margin-top:16px;padding:18px;border:1px solid #1b3548;border-radius:18px;background:#0b1823}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.btn{appearance:none;border:1px solid #2d5874;background:#12324a;color:white;border-radius:14px;padding:14px 12px;font-weight:700;font-size:15px;cursor:pointer}.btn:active{transform:scale(.98)}.btn.warn{border-color:#71453a;background:#3b211c}.field,select,textarea{width:100%;background:#07131d;color:white;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}label{display:block;color:#9fb4c3;font-size:13px;margin:12px 0 6px}.status{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:44px}.device{display:flex;justify-content:space-between;gap:12px;align-items:center}.ok{color:#6ef0ab}.bad{color:#ff9d8f}@media(max-width:600px){.wrap{padding:14px}.hero{padding:18px}h1{font-size:24px}}
  </style></head><body><main class="wrap"><section class="hero"><h1>JARVIS Commander</h1><p class="sub">MacBook・ZBook・iPhoneから登録済みAndroidを直接操作</p><div class="row"><span id="broker" class="pill">Broker確認中</span><span id="count" class="pill">端末 0</span></div></section>
  <section class="panel"><div class="device"><div><strong>操作する端末</strong><div id="deviceDetail" class="sub">読み込み中</div></div><button class="btn" onclick="refresh()">更新</button></div><label>端末</label><select id="device"></select></section>
  <section class="panel"><strong>クイック操作</strong><div class="grid" style="margin-top:12px"><button class="btn" onclick="send('wake-device',{})">画面を起こす</button><button class="btn" onclick="send('device-status',{})">端末状態</button><button class="btn" onclick="send('open-app',{packageName:'com.google.android.apps.docs.editors.sheets'})">スプレッドシート</button><button class="btn" onclick="send('open-app',{packageName:'com.android.chrome'})">Chrome</button><button class="btn" onclick="send('open-app',{packageName:'com.google.android.apps.maps'})">Google Maps</button><button class="btn" onclick="send('launch-settings',{screen:'wifi'})">Wi-Fi設定</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'home'}]})">ホーム</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'back'}]})">戻る</button></div></section>
  <section class="panel"><strong>URL・アプリ・通知</strong><label>URL</label><input id="url" class="field" placeholder="https://example.com"><button class="btn" style="margin-top:8px" onclick="openUrl()">URLを開く</button><label>Android package name</label><input id="pkg" class="field" placeholder="com.example.app"><button class="btn" style="margin-top:8px" onclick="openApp()">アプリを起動</button><label>通知メッセージ</label><input id="msg" class="field" placeholder="JARVISからテスト"><button class="btn" style="margin-top:8px" onclick="notify()">通知を送る</button></section>
  <section class="panel"><strong>自動操作シーケンス</strong><p class="sub">JSONで1〜50ステップ。例: [{"action":"home"},{"action":"wait","ms":500}]</p><textarea id="steps" rows="5">[{"action":"home"}]</textarea><button class="btn" style="margin-top:8px" onclick="sequence()">実行</button></section>
  <section class="panel"><strong>実行結果</strong><pre id="status" class="status">待機中</pre></section>
  </main><script>
  const KEY=${k}; const H={'Content-Type':'application/json','X-JARVIS-Commander-Key':KEY}; let fleet=[];
  function target(){return document.getElementById('device').value||undefined}
  async function api(path,options={}){const r=await fetch(path+(path.includes('?')?'&':'?')+'key='+encodeURIComponent(KEY),{...options,headers:{...H,...(options.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b={message:t}}if(!r.ok)throw new Error(b.message||('HTTP '+r.status));return b}
  async function refresh(){try{const s=await api('/api/state');fleet=s.fleet||[];document.getElementById('broker').textContent='Broker 接続中';document.getElementById('broker').className='pill ok';document.getElementById('count').textContent='端末 '+fleet.length;const sel=document.getElementById('device');const keep=sel.value;sel.innerHTML=fleet.map(n=>'<option value="'+escapeHtml(n.id)+'">'+escapeHtml(n.label||n.id)+' · '+escapeHtml(n.status||'unknown')+'</option>').join('');if(keep&&fleet.some(n=>n.id===keep))sel.value=keep;detail()}catch(e){document.getElementById('broker').textContent='Broker エラー';document.getElementById('broker').className='pill bad';show(e.message)}}
  function escapeHtml(x){return String(x).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
  function detail(){const n=fleet.find(x=>x.id===target());document.getElementById('deviceDetail').textContent=n?((n.label||n.id)+' / '+n.status+' / '+(n.telemetry?.batteryPercent??'?')+'%'):'端末なし'}document.getElementById('device').addEventListener('change',detail)
  function show(x){document.getElementById('status').textContent=typeof x==='string'?x:JSON.stringify(x,null,2)}
  async function send(type,payload){try{show('送信中…');const b=await api('/api/task',{method:'POST',body:JSON.stringify({type,payload,targetNodeId:target(),idempotencyKey:type+':'+Date.now()})});show(b);setTimeout(refresh,1200)}catch(e){show('エラー: '+e.message)}}
  function openUrl(){const u=document.getElementById('url').value.trim();if(!u.startsWith('https://'))return show('https:// から始まるURLを入力');send('open-url',{url:u})}
  function openApp(){const p=document.getElementById('pkg').value.trim();if(!p)return show('package nameを入力');send('open-app',{packageName:p})}
  function notify(){const m=document.getElementById('msg').value.trim();send('show-notification',{title:'JARVIS',message:m||'JARVISからテスト'})}
  function sequence(){try{const steps=JSON.parse(document.getElementById('steps').value);send('ui-sequence',{steps})}catch(e){show('JSONエラー: '+e.message)}}
  refresh();setInterval(refresh,3000);
  </script></body></html>`;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "jarvis-direct-commander" });
    if (request.method === "GET" && url.pathname === `/c/${encodeURIComponent(accessKey)}`) return html(response, 200, page(accessKey));
    if (!authorized(request, url)) return json(response, 401, { message: "commander access denied" });
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, await brokerFetch("/api/jarvis/admin/state"));
    if (request.method === "POST" && url.pathname === "/api/task") {
      const payload = await readJson(request);
      return json(response, 201, await brokerFetch("/api/jarvis/admin/tasks", { method: "POST", body: JSON.stringify(payload) }));
    }
    return json(response, 404, { message: "not found" });
  } catch (error) { return json(response, 500, { message: error instanceof Error ? error.message : "internal error", trace: createHash("sha256").update(String(error)).digest("hex").slice(0,12) }); }
}).listen(port, host, () => console.log(`[jarvis-direct-commander] listening on http://${host}:${port}`));
