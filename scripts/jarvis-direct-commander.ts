import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const host = process.env.JARVIS_COMMANDER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.JARVIS_COMMANDER_PORT || 8790);
const broker = process.env.JARVIS_COMMANDER_BROKER?.trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const accessKey = process.env.JARVIS_COMMANDER_KEY?.trim() || "";
if (!ownerToken || !accessKey) throw new Error("JARVIS_OWNER_TOKEN and JARVIS_COMMANDER_KEY are required");

const firstChoices = {
  right: { label: "右翼金魚", cell: "C7", clickText: "床掘はちみつ" },
  spring: { label: "春巻き金魚", cell: "G7", clickText: "春巻きプニさん" },
  poi: { label: "ポイ活金魚", cell: "J7", clickText: "ポイ活くんハチミツ" },
} as const;
const secondChoices = {
  right: { label: "右翼QR", cell: "C5", clickText: "オオグンタマQR" },
  spring: { label: "春巻きQR", cell: "G6", clickText: "春巻QR" },
  poi: { label: "ポイ活QR", cell: "J6", clickText: "ポイ活くんQR" },
} as const;
type ChoiceKey = keyof typeof firstChoices;

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
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  response.end(body);
}
async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += b.length;
    if (bytes > 200_000) throw new Error("body too large"); chunks.push(b);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
async function brokerFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${broker}${path}`, { ...init, headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  const text = await response.text(); let body: unknown = text;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!response.ok) throw new Error(typeof body === "object" && body && "message" in body ? String((body as { message?: unknown }).message) : `Broker HTTP ${response.status}`);
  return body;
}
function taskBody(type: string, payload: unknown, targetNodeId: string, suffix: string) {
  return { type, payload, targetNodeId, idempotencyKey: `${type}:${Date.now()}:${suffix}` };
}
function parseChoice(value: unknown, map: Record<string, unknown>, name: string): ChoiceKey {
  const key = String(value || "").trim() as ChoiceKey;
  if (!key || !(key in map)) throw new Error(`${name}の選択が不正です`);
  return key;
}

async function enqueueChoiceFlow(input: Record<string, unknown>) {
  const targetNodeId = String(input.targetNodeId || "").trim();
  if (!targetNodeId) throw new Error("targetNodeId is required");
  const firstKey = parseChoice(input.firstChoice, firstChoices, "1段目");
  const secondKey = parseChoice(input.secondChoice, secondChoices, "2段目");
  const first = firstChoices[firstKey]; const second = secondChoices[secondKey];
  const packageName = "com.google.android.apps.docs.editors.sheets";

  const openTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST", body: JSON.stringify(taskBody("open-app", { packageName }, targetNodeId, "sheet-open")),
  });
  const steps: Array<Record<string, unknown>> = [
    { action: "wait", ms: 1200 },
    { action: "ensure-open-text", text: "TikTok Lite", timeoutMs: 8000 },
    { action: "wait", ms: 1200 },
    { action: "click-text-retry", text: first.clickText, timeoutMs: 7000 },
    { action: "wait", ms: 2500 },
    { action: "back" },
    { action: "wait", ms: 1200 },
    { action: "click-text-retry", text: second.clickText, timeoutMs: 7000 },
    { action: "wait", ms: 2500 },
    { action: "home" },
  ];
  const sequenceTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST", body: JSON.stringify(taskBody("ui-sequence", { steps }, targetNodeId, "sheet-choice-sequence")),
  });
  return {
    accepted: true,
    first: { key: firstKey, label: first.label, cell: first.cell },
    second: { key: secondKey, label: second.label, cell: second.cell },
    message: `${first.label}（${first.cell}）→ スプレッドシートへ戻る → ${second.label}（${second.cell}）→ ホームへ戻る`,
    stages: [openTask, sequenceTask],
  };
}

function page(key: string) {
  const k = JSON.stringify(key).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:980px;margin:auto;padding:20px}.hero,.panel{border:1px solid #24445b;border-radius:20px;background:#0b1823;padding:18px;margin-top:14px}.hero{background:linear-gradient(145deg,#102637,#071019)}h1{margin:0;font-size:28px}.sub,.hint{color:#91aabd;line-height:1.5}.row,.grid,.choiceGrid,.rangeGrid{display:grid;gap:10px}.grid,.choiceGrid{grid-template-columns:repeat(3,1fr)}.rangeGrid{grid-template-columns:100px 100px 1fr 1fr}.btn,.choiceBtn{border:1px solid #2d5874;background:#12324a;color:white;border-radius:14px;padding:13px;font-weight:700;font-size:15px}.btn.primary,.choiceBtn.selected{background:#0b6a54;border-color:#71efbd}.field,select{width:100%;background:#07131d;color:white;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}.pill{display:inline-block;background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;margin:8px 8px 0 0}.assignment{border:1px solid #24445b;border-radius:14px;padding:12px;margin-top:10px}.summary{margin-top:9px;color:#c8dce9}.status{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:70px}.ok{color:#6ef0ab}.bad{color:#ff9d8f}@media(max-width:700px){.wrap{padding:12px}.grid,.choiceGrid,.rangeGrid{grid-template-columns:1fr}.rangeGrid{grid-template-columns:1fr 1fr}h1{font-size:24px}}
  </style></head><body><main class="wrap">
  <section class="hero"><h1>JARVIS Commander</h1><p class="sub">端末番号の範囲ごとにスプレッドシート作業を割り当て可能</p><span id="broker" class="pill">Broker確認中</span><span id="count" class="pill">端末 0</span></section>
  <section class="panel"><strong>クイック操作</strong><label>端末</label><select id="device"></select><div class="grid" style="margin-top:10px"><button class="btn" onclick="send('wake-device',{})">画面を起こす</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'home'}]})">ホーム</button><button class="btn" onclick="send('launch-settings',{screen:'wifi'})">Wi-Fi設定</button></div></section>
  <section class="panel"><strong>範囲で一括設定</strong><p class="sub">例：1〜20を「右翼金魚 → 春巻きQR」に設定。実行すると、1段目→戻る→2段目→ホームまで自動で流します。</p>
    <div class="rangeGrid"><div><label>開始</label><input id="rangeStart" class="field" type="number" min="1" value="1"></div><div><label>終了</label><input id="rangeEnd" class="field" type="number" min="1" value="20"></div><div><label>最初</label><select id="rangeFirst"><option value="right">右翼金魚 C7</option><option value="spring">春巻き金魚 G7</option><option value="poi">ポイ活金魚 J7</option></select></div><div><label>次</label><select id="rangeSecond"><option value="right">右翼QR C5</option><option value="spring" selected>春巻きQR G6</option><option value="poi">ポイ活QR J6</option></select></div></div>
    <button class="btn primary" style="width:100%;margin-top:12px" onclick="applyRange()">この範囲に設定</button>
    <button class="btn primary" style="width:100%;margin-top:10px" onclick="runConfigured()">設定済み端末をまとめて実行</button>
  </section>
  <section class="panel"><strong>端末別設定</strong><div id="assignmentList"></div></section>
  <section class="panel"><strong>実行結果</strong><pre id="status" class="status">待機中</pre></section>
  </main><script>
  const KEY=${k};const H={'Content-Type':'application/json','X-JARVIS-Commander-Key':KEY};let fleet=[];const assignments={};
  const FIRST={right:{label:'右翼金魚',cell:'C7'},spring:{label:'春巻き金魚',cell:'G7'},poi:{label:'ポイ活金魚',cell:'J7'}};
  const SECOND={right:{label:'右翼QR',cell:'C5'},spring:{label:'春巻きQR',cell:'G6'},poi:{label:'ポイ活QR',cell:'J6'}};
  function target(){return document.getElementById('device').value||undefined}
  function deviceNumber(n){const m=String(n.label||'').match(/(\\d+)(?!.*\\d)/);return m?Number(m[1]):null}
  function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replaceAll(String.fromCharCode(34),'&quot;')}
  async function api(path,options={}){const r=await fetch(path+(path.includes('?')?'&':'?')+'key='+encodeURIComponent(KEY),{...options,headers:{...H,...(options.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b={message:t}}if(!r.ok)throw new Error(b.message||('HTTP '+r.status));return b}
  function show(x){document.getElementById('status').textContent=typeof x==='string'?x:JSON.stringify(x,null,2);document.getElementById('status').scrollIntoView({behavior:'smooth',block:'center'})}
  async function refresh(){try{const s=await api('/api/state');fleet=s.fleet||[];document.getElementById('broker').textContent='Broker 接続中';document.getElementById('broker').className='pill ok';document.getElementById('count').textContent='端末 '+fleet.length;const sel=document.getElementById('device');const keep=sel.value;sel.innerHTML=fleet.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.label||n.id)+' · '+esc(n.status||'unknown')+'</option>').join('');if(keep&&fleet.some(n=>n.id===keep))sel.value=keep;renderAssignments()}catch(e){document.getElementById('broker').textContent='Broker エラー';document.getElementById('broker').className='pill bad';show('エラー: '+e.message)}}
  async function send(type,payload){try{const b=await api('/api/task',{method:'POST',body:JSON.stringify({type,payload,targetNodeId:target(),idempotencyKey:type+':'+Date.now()})});show('受付完了 ✅\\n'+type+'\\n状態: '+((b.task||b).status||'queued'))}catch(e){show('エラー: '+e.message)}}
  function choose(node,stage,key){assignments[node]=assignments[node]||{};assignments[node][stage]=key;renderAssignments()}
  function choiceButtons(node,stage,map){const current=assignments[node]?.[stage];return Object.entries(map).map(([key,v])=>'<button class="choiceBtn '+(current===key?'selected':'')+'" onclick="choose(\''+esc(node)+'\',\''+stage+'\',\''+key+'\')">'+esc(v.label)+'<br><small>'+esc(v.cell)+'</small></button>').join('')}
  function renderAssignments(){const root=document.getElementById('assignmentList');if(!fleet.length){root.innerHTML='<p class="sub">登録端末なし</p>';return}const sorted=[...fleet].sort((a,b)=>(deviceNumber(a)??999999)-(deviceNumber(b)??999999));root.innerHTML=sorted.map(n=>{const a=assignments[n.id]||{};const num=deviceNumber(n);const summary=a.first&&a.second?FIRST[a.first].label+' → '+SECOND[a.second].label:'未設定';return '<div class="assignment"><strong>'+(num!==null?'#'+num+' ':'')+esc(n.label||n.id)+'</strong><div class="hint">'+esc(n.status||'unknown')+'</div><div class="choiceGrid" style="margin-top:8px">'+choiceButtons(n.id,'first',FIRST)+'</div><div class="choiceGrid" style="margin-top:8px">'+choiceButtons(n.id,'second',SECOND)+'</div><div class="summary">'+esc(summary)+'</div></div>'}).join('')}
  function applyRange(){const start=Number(document.getElementById('rangeStart').value);const end=Number(document.getElementById('rangeEnd').value);const first=document.getElementById('rangeFirst').value;const second=document.getElementById('rangeSecond').value;if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)return show('範囲を確認してください');let count=0;for(const n of fleet){const num=deviceNumber(n);if(num!==null&&num>=start&&num<=end){assignments[n.id]={first,second};count++}}renderAssignments();show(start+'〜'+end+'番の '+count+'台を '+FIRST[first].label+' → '+SECOND[second].label+' に設定しました')}
  async function runConfigured(){const jobs=fleet.filter(n=>assignments[n.id]?.first&&assignments[n.id]?.second);if(!jobs.length)return show('実行設定された端末がありません');show(jobs.length+'台へタスク送信中…');const results=[];for(const n of jobs){const a=assignments[n.id];try{const b=await api('/api/spreadsheet-choice-flow',{method:'POST',body:JSON.stringify({targetNodeId:n.id,firstChoice:a.first,secondChoice:a.second})});results.push('✅ '+(n.label||n.id)+': '+b.first.label+' → '+b.second.label+' → 終了')}catch(e){results.push('❌ '+(n.label||n.id)+': '+e.message)}}show(results.join('\\n'))}
  refresh();setInterval(refresh,3000);
  </script></body></html>`;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "jarvis-direct-commander", host, port });
    if (request.method === "GET" && url.pathname === `/c/${encodeURIComponent(accessKey)}`) return html(response, 200, page(accessKey));
    if (!authorized(request, url)) return json(response, 401, { message: "commander access denied" });
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, await brokerFetch("/api/jarvis/admin/state"));
    if (request.method === "POST" && url.pathname === "/api/task") {
      const payload = await readJson(request);
      return json(response, 201, await brokerFetch("/api/jarvis/admin/tasks", { method: "POST", body: JSON.stringify(payload) }));
    }
    if (request.method === "POST" && url.pathname === "/api/spreadsheet-choice-flow") {
      const payload = await readJson(request) as Record<string, unknown>;
      return json(response, 201, await enqueueChoiceFlow(payload));
    }
    return json(response, 404, { message: "not found" });
  } catch (error) {
    return json(response, 500, { message: error instanceof Error ? error.message : "internal error", trace: createHash("sha256").update(String(error)).digest("hex").slice(0, 12) });
  }
}).listen(port, host, () => console.log(`[jarvis-direct-commander] listening on http://${host}:${port}`));
