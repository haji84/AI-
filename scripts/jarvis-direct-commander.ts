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
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function keyFrom(request: IncomingMessage, url: URL) {
  const header = request.headers["x-jarvis-commander-key"];
  return typeof header === "string" ? header : url.searchParams.get("key") || "";
}

function authorized(request: IncomingMessage, url: URL) {
  return safeEqual(keyFrom(request, url), accessKey);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  response.end(body);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > 200_000) throw new Error("body too large");
    chunks.push(b);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function brokerFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${broker}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: unknown }).message)
        : `Broker HTTP ${response.status}`,
    );
  }
  return body;
}

function taskBody(type: string, payload: unknown, targetNodeId: string, suffix: string) {
  return {
    type,
    payload,
    targetNodeId,
    idempotencyKey: `${type}:${Date.now()}:${suffix}`,
  };
}

function normalizeTargets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean);
}

async function enqueueSpreadsheetFlow(input: Record<string, unknown>) {
  const targetNodeId = String(input.targetNodeId || "").trim();
  if (!targetNodeId) throw new Error("targetNodeId is required");

  const fileName = String(input.fileName || "TikTok Lite").trim() || "TikTok Lite";
  const targets = normalizeTargets(input.targets);
  const backAfterEach = input.backAfterEach === true;
  const backBetweenTargets = input.backBetweenTargets === true;
  const packageName = "com.google.android.apps.docs.editors.sheets";

  const openTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody("open-app", { packageName }, targetNodeId, "sheet-open")),
  });

  const steps: Array<Record<string, unknown>> = [
    { action: "wait", ms: 1200 },
    { action: "ensure-open-text", text: fileName, timeoutMs: 8000 },
    { action: "wait", ms: 1200 },
  ];

  targets.forEach((target, index) => {
    steps.push({ action: "click-text-retry", text: target, timeoutMs: 7000 });
    steps.push({ action: "wait", ms: 900 });
    const shouldBack = backAfterEach || (backBetweenTargets && index < targets.length - 1);
    if (shouldBack) {
      steps.push({ action: "back" });
      steps.push({ action: "wait", ms: 900 });
    }
  });

  if (steps.length > 50) throw new Error("指定項目が多すぎます。1回の実行は50ステップ以内にしてください");

  const sequenceTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody("ui-sequence", { steps }, targetNodeId, "sheet-sequence")),
  });

  return {
    accepted: true,
    fileName,
    targetCount: targets.length,
    message: targets.length
      ? `「${fileName}」を開き、${targets.length}件を順番に実行します`
      : `「${fileName}」を開きます`,
    stages: [openTask, sequenceTask],
  };
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
  const first = firstChoices[firstKey];
  const second = secondChoices[secondKey];
  const result = await enqueueSpreadsheetFlow({
    targetNodeId,
    fileName: "TikTok Lite",
    targets: [first.clickText, second.clickText],
    backBetweenTargets: true,
  });
  return {
    ...result,
    first: { key: firstKey, label: first.label, cell: first.cell },
    second: { key: secondKey, label: second.label, cell: second.cell },
    message: `${first.label}（${first.cell}）→ ${second.label}（${second.cell}）を ${targetNodeId} で実行します`,
  };
}

function page(key: string) {
  const k = JSON.stringify(key).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:900px;margin:auto;padding:24px}.hero{padding:22px;border:1px solid #24445b;border-radius:22px;background:linear-gradient(145deg,#102637,#071019);box-shadow:0 18px 50px #0008}h1{margin:0;font-size:28px;letter-spacing:.06em}.sub{color:#95adc0;margin:8px 0 0;line-height:1.55}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.pill{background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;font-size:13px}.panel{margin-top:16px;padding:18px;border:1px solid #1b3548;border-radius:18px;background:#0b1823}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.btn{appearance:none;border:1px solid #2d5874;background:#12324a;color:white;border-radius:14px;padding:14px 12px;font-weight:700;font-size:15px;cursor:pointer}.btn:active{transform:scale(.98)}.btn.primary{background:#15506f;border-color:#4e9dca}.btn.selected{background:#0b6a54;border-color:#71efbd}.field,select,textarea{width:100%;background:#07131d;color:white;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}label{display:block;color:#9fb4c3;font-size:13px;margin:12px 0 6px}.status{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:60px;overflow:auto}.device{display:flex;justify-content:space-between;gap:12px;align-items:center}.ok{color:#6ef0ab}.bad{color:#ff9d8f}.check{display:flex;gap:10px;align-items:center;margin-top:12px;color:#c6d7e3}.check input{width:20px;height:20px}.hint{font-size:12px;color:#7894a7}.assignment{margin-top:12px;border:1px solid #24445b;border-radius:16px;padding:14px;background:#08141e}.assignment h3{margin:0 0 4px;font-size:16px}.choiceTitle{margin:14px 0 8px;font-weight:700}.choiceGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.choiceBtn{appearance:none;border:1px solid #2d5874;background:#10283a;color:white;border-radius:12px;padding:12px 8px;font-weight:700;cursor:pointer}.choiceBtn small{display:block;color:#91aabd;margin-top:4px}.choiceBtn.selected{background:#0b6a54;border-color:#71efbd}.hidden{display:none}.summary{margin-top:12px;color:#c8dce9;font-size:13px;line-height:1.5}.batch{width:100%;margin-top:14px}@media(max-width:600px){.wrap{padding:14px}.hero{padding:18px}h1{font-size:24px}.choiceGrid{grid-template-columns:1fr}}
  </style></head><body><main class="wrap"><section class="hero"><h1>JARVIS Commander</h1><p class="sub">MacBook・ZBook・iPhoneから登録済みAndroidを直接操作</p><div class="row"><span id="broker" class="pill">Broker確認中</span><span id="count" class="pill">端末 0</span></div></section>
  <section class="panel"><div class="device"><div><strong>操作する端末</strong><div id="deviceDetail" class="sub">読み込み中</div></div><button class="btn" onclick="refresh()">更新</button></div><label>端末</label><select id="device"></select></section>
  <section class="panel"><strong>クイック操作</strong><div class="grid" style="margin-top:12px"><button class="btn" onclick="send('wake-device',{})">画面を起こす</button><button class="btn" onclick="send('device-status',{})">端末状態</button><button class="btn primary" onclick="document.getElementById('deviceAssignments').scrollIntoView({behavior:'smooth'})">スプレッドシート作業</button><button class="btn" onclick="send('open-app',{packageName:'com.android.chrome'})">Chrome</button><button class="btn" onclick="send('open-app',{packageName:'com.google.android.apps.maps'})">Google Maps</button><button class="btn" onclick="send('launch-settings',{screen:'wifi'})">Wi-Fi設定</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'home'}]})">ホーム</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'back'}]})">戻る</button></div></section>
  <section id="deviceAssignments" class="panel"><strong>TikTok Lite 端末別タスク</strong><p class="sub">端末ごとに、最初の金魚ボタン → 次のQRボタンを指定できます。1段目を選ぶと2段目が出ます。</p><div id="assignmentList"></div><button class="btn primary batch" onclick="runConfigured()">設定済み端末をまとめて実行</button></section>
  <section id="sheetTask" class="panel"><strong>自由指定スプレッドシート作業</strong><p class="sub">Sheetsを開き、「TikTok Lite」ファイルへ移動して、指定した項目を上から順番に押します。</p><label>ファイル名</label><input id="sheetFile" class="field" value="TikTok Lite"><label>押す項目（1行に1つ、上から順番）</label><textarea id="sheetTargets" rows="6" placeholder="例：\n春巻QR\n5~56サッカー\nなおきQR"></textarea><label class="check"><input id="sheetBack" type="checkbox">各項目を押したあと「戻る」を1回実行</label><p class="hint">リンクを開いたあと毎回シートへ戻したい場合だけオン。</p><button class="btn primary" style="margin-top:12px;width:100%" onclick="spreadsheetTask()">この順番でタスク実行</button></section>
  <section class="panel"><strong>URL・アプリ・通知</strong><label>URL</label><input id="url" class="field" placeholder="https://example.com"><button class="btn" style="margin-top:8px" onclick="openUrl()">URLを開く</button><label>Android package name</label><input id="pkg" class="field" placeholder="com.example.app"><button class="btn" style="margin-top:8px" onclick="openApp()">アプリを起動</button><label>通知メッセージ</label><input id="msg" class="field" placeholder="JARVISからテスト"><button class="btn" style="margin-top:8px" onclick="notify()">通知を送る</button></section>
  <section class="panel"><strong>自動操作シーケンス</strong><p class="sub">JSONで1〜50ステップ。</p><textarea id="steps" rows="5">[{"action":"home"}]</textarea><button class="btn" style="margin-top:8px" onclick="sequence()">実行</button></section>
  <section class="panel"><strong>実行結果</strong><pre id="status" class="status">待機中</pre></section>
  </main><script>
  const KEY=${k};const H={'Content-Type':'application/json','X-JARVIS-Commander-Key':KEY};let fleet=[];const assignments={};
  const FIRST={right:{label:'右翼金魚',cell:'C7'},spring:{label:'春巻き金魚',cell:'G7'},poi:{label:'ポイ活金魚',cell:'J7'}};
  const SECOND={right:{label:'右翼QR',cell:'C5'},spring:{label:'春巻きQR',cell:'G6'},poi:{label:'ポイ活QR',cell:'J6'}};
  function target(){return document.getElementById('device').value||undefined}
  async function api(path,options={}){const r=await fetch(path+(path.includes('?')?'&':'?')+'key='+encodeURIComponent(KEY),{...options,headers:{...H,...(options.headers||{})}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b={message:t}}if(!r.ok)throw new Error(b.message||('HTTP '+r.status));return b}
  async function refresh(){try{const s=await api('/api/state');fleet=s.fleet||[];document.getElementById('broker').textContent='Broker 接続中';document.getElementById('broker').className='pill ok';document.getElementById('count').textContent='端末 '+fleet.length;const sel=document.getElementById('device');const keep=sel.value;sel.innerHTML=fleet.map(n=>'<option value="'+escapeHtml(n.id)+'">'+escapeHtml(n.label||n.id)+' · '+escapeHtml(n.status||'unknown')+'</option>').join('');if(keep&&fleet.some(n=>n.id===keep))sel.value=keep;detail();renderAssignments()}catch(e){document.getElementById('broker').textContent='Broker エラー';document.getElementById('broker').className='pill bad';show('エラー: '+e.message)}}
  function escapeHtml(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replaceAll(String.fromCharCode(34),'&quot;')}
  function detail(){const n=fleet.find(x=>x.id===target());document.getElementById('deviceDetail').textContent=n?((n.label||n.id)+' / '+n.status+' / '+(n.telemetry?.batteryPercent??'?')+'%'):'端末なし'}document.getElementById('device').addEventListener('change',detail)
  function show(x){document.getElementById('status').textContent=typeof x==='string'?x:JSON.stringify(x,null,2);document.getElementById('status').scrollIntoView({behavior:'smooth',block:'center'})}
  async function send(type,payload){try{show('タスク送信中…');const b=await api('/api/task',{method:'POST',body:JSON.stringify({type,payload,targetNodeId:target(),idempotencyKey:type+':'+Date.now()})});const task=b.task||b;show('受付完了 ✅\n'+type+' をAndroidへ送信しました。\n状態: '+(task.status||'queued')+'\nタスクID: '+(task.id||'取得中'));setTimeout(refresh,1200)}catch(e){show('エラー: '+e.message)}}
  async function spreadsheetTask(){try{const node=target();if(!node)return show('操作する端末がありません');const fileName=document.getElementById('sheetFile').value.trim()||'TikTok Lite';const targets=document.getElementById('sheetTargets').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const backAfterEach=document.getElementById('sheetBack').checked;show('スプレッドシート作業を準備中…');const b=await api('/api/spreadsheet-flow',{method:'POST',body:JSON.stringify({targetNodeId:node,fileName,targets,backAfterEach})});show('タスク受付完了 ✅\n'+b.message+'\n\nSheets起動 → ファイル確認 → 指定項目を順番に実行します。')}catch(e){show('エラー: '+e.message)}}
  function choose(node,stage,key){assignments[node]=assignments[node]||{};assignments[node][stage]=key;if(stage==='first')assignments[node].second=undefined;renderAssignments()}
  function renderChoiceButtons(node,stage,map){const current=assignments[node]?.[stage];return Object.entries(map).map(([key,v])=>'<button class="choiceBtn '+(current===key?'selected':'')+'" onclick="choose(\''+escapeHtml(node)+'\',\''+stage+'\',\''+key+'\')">'+escapeHtml(v.label)+'<small>'+escapeHtml(v.cell)+'</small></button>').join('')}
  function renderAssignments(){const root=document.getElementById('assignmentList');if(!fleet.length){root.innerHTML='<p class="sub">登録端末なし</p>';return}root.innerHTML=fleet.map(n=>{const a=assignments[n.id]||{};const summary=a.first?(FIRST[a.first].label+'（'+FIRST[a.first].cell+'）'+(a.second?' → '+SECOND[a.second].label+'（'+SECOND[a.second].cell+'）':' → QR未選択')):'未設定';return '<div class="assignment"><h3>'+escapeHtml(n.label||n.id)+'</h3><div class="hint">'+escapeHtml(n.status||'unknown')+' / '+escapeHtml(n.telemetry?.batteryPercent??'?')+'%</div><div class="choiceTitle">① 最初に押す</div><div class="choiceGrid">'+renderChoiceButtons(n.id,'first',FIRST)+'</div><div class="'+(a.first?'':'hidden')+'"><div class="choiceTitle">② 次に押す</div><div class="choiceGrid">'+renderChoiceButtons(n.id,'second',SECOND)+'</div></div><div class="summary">'+escapeHtml(summary)+'</div><button class="btn primary batch" '+(a.first&&a.second?'':'disabled')+' onclick="runAssignment(\''+escapeHtml(n.id)+'\')">この端末で実行</button></div>'}).join('')}
  async function runAssignment(node){const a=assignments[node]||{};if(!a.first||!a.second)return show('1段目と2段目を両方選んでください');try{show('端末タスクを準備中…');const b=await api('/api/spreadsheet-choice-flow',{method:'POST',body:JSON.stringify({targetNodeId:node,firstChoice:a.first,secondChoice:a.second})});show('受付完了 ✅\n'+b.message+'\n\nSheets → TikTok Lite → 1段目 → 戻る → 2段目 の順で実行します。')}catch(e){show('エラー: '+e.message)}}
  async function runConfigured(){const jobs=fleet.filter(n=>assignments[n.id]?.first&&assignments[n.id]?.second);if(!jobs.length)return show('実行設定された端末がありません');show(jobs.length+'台へタスク送信中…');const results=[];for(const n of jobs){const a=assignments[n.id];try{const b=await api('/api/spreadsheet-choice-flow',{method:'POST',body:JSON.stringify({targetNodeId:n.id,firstChoice:a.first,secondChoice:a.second})});results.push('✅ '+(n.label||n.id)+': '+b.first.label+' → '+b.second.label)}catch(e){results.push('❌ '+(n.label||n.id)+': '+e.message)}}show(results.join('\n'))}
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
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "jarvis-direct-commander", host, port });
    }
    if (request.method === "GET" && url.pathname === `/c/${encodeURIComponent(accessKey)}`) {
      return html(response, 200, page(accessKey));
    }
    if (!authorized(request, url)) return json(response, 401, { message: "commander access denied" });
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, await brokerFetch("/api/jarvis/admin/state"));
    }
    if (request.method === "POST" && url.pathname === "/api/task") {
      const payload = await readJson(request);
      return json(response, 201, await brokerFetch("/api/jarvis/admin/tasks", {
        method: "POST",
        body: JSON.stringify(payload),
      }));
    }
    if (request.method === "POST" && url.pathname === "/api/spreadsheet-flow") {
      const payload = await readJson(request) as Record<string, unknown>;
      return json(response, 201, await enqueueSpreadsheetFlow(payload));
    }
    if (request.method === "POST" && url.pathname === "/api/spreadsheet-choice-flow") {
      const payload = await readJson(request) as Record<string, unknown>;
      return json(response, 201, await enqueueChoiceFlow(payload));
    }
    return json(response, 404, { message: "not found" });
  } catch (error) {
    return json(response, 500, {
      message: error instanceof Error ? error.message : "internal error",
      trace: createHash("sha256").update(String(error)).digest("hex").slice(0, 12),
    });
  }
}).listen(port, host, () => console.log(`[jarvis-direct-commander] listening on http://${host}:${port}`));
