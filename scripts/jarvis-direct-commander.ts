import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const host = process.env.JARVIS_COMMANDER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.JARVIS_COMMANDER_PORT || 8790);
const broker = process.env.JARVIS_COMMANDER_BROKER?.trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const accessKey = process.env.JARVIS_COMMANDER_KEY?.trim() || "";
if (!ownerToken || !accessKey) throw new Error("JARVIS_OWNER_TOKEN and JARVIS_COMMANDER_KEY are required");

const firstChoices = {
  right: { alias: "右翼金魚", cell: "C7", text: "床堀はちみつ" },
  spring: { alias: "春巻き金魚", cell: "G7", text: "春巻きプニさん" },
  poi: { alias: "ポイ活金魚", cell: "J7", text: "ポイ活くんハチミツ" },
} as const;

const secondChoices = {
  right: { alias: "右翼QR", cell: "C5", text: "オオゲンタマQR" },
  spring: { alias: "春巻きQR", cell: "G6", text: "春巻QR" },
  poi: { alias: "ポイ活QR", cell: "J6", text: "ポイ活くんQR" },
} as const;

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

  for (const target of targets) {
    steps.push({ action: "click-text-retry", text: target, timeoutMs: 7000 });
    steps.push({ action: "wait", ms: 900 });
    if (backAfterEach) {
      steps.push({ action: "back" });
      steps.push({ action: "wait", ms: 900 });
    }
  }

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

function choice<T extends Record<string, { alias: string; cell: string; text: string }>>(table: T, raw: unknown, label: string) {
  const key = String(raw || "").trim() as keyof T;
  const item = table[key];
  if (!item) throw new Error(`${label}の候補が不正です`);
  return { key: String(key), ...item };
}

async function enqueuePresetFlow(input: Record<string, unknown>) {
  const targetNodeId = String(input.targetNodeId || "").trim();
  if (!targetNodeId) throw new Error("targetNodeId is required");

  const first = choice(firstChoices, input.firstChoice, "1段目");
  const second = choice(secondChoices, input.secondChoice, "2段目");
  const packageName = "com.google.android.apps.docs.editors.sheets";

  const openTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody("open-app", { packageName }, targetNodeId, `preset-open-${first.key}-${second.key}`)),
  });

  const steps: Array<Record<string, unknown>> = [
    { action: "wait", ms: 1200 },
    { action: "ensure-open-text", text: "TikTok Lite", timeoutMs: 8000 },
    { action: "wait", ms: 1200 },
    { action: "click-text-retry", text: first.text, timeoutMs: 8000 },
    { action: "wait", ms: 1400 },
    { action: "ensure-open-text", text: second.text, timeoutMs: 9000 },
    { action: "wait", ms: 800 },
  ];

  const sequenceTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody("ui-sequence", { steps }, targetNodeId, `preset-sequence-${first.key}-${second.key}`)),
  });

  return {
    accepted: true,
    targetNodeId,
    first: { alias: first.alias, cell: first.cell },
    second: { alias: second.alias, cell: second.cell },
    message: `${first.alias}（${first.cell}）→ ${second.alias}（${second.cell}）を順番に実行します`,
    stages: [openTask, sequenceTask],
  };
}

async function enqueuePresetBatch(input: Record<string, unknown>) {
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  if (!assignments.length) throw new Error("端末への割当がありません");
  if (assignments.length > 30) throw new Error("一度に実行できる端末は30台までです");

  const results = [];
  for (const raw of assignments) {
    if (!raw || typeof raw !== "object") continue;
    results.push(await enqueuePresetFlow(raw as Record<string, unknown>));
  }
  if (!results.length) throw new Error("有効な端末割当がありません");
  return {
    accepted: true,
    count: results.length,
    message: `${results.length}台へスプレッドシート作業を割り当てました`,
    results,
  };
}

function page(key: string) {
  const k = JSON.stringify(key).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:900px;margin:auto;padding:24px}.hero{padding:22px;border:1px solid #24445b;border-radius:22px;background:linear-gradient(145deg,#102637,#071019);box-shadow:0 18px 50px #0008}h1{margin:0;font-size:28px;letter-spacing:.06em}.sub{color:#95adc0;margin:8px 0 0;line-height:1.55}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.pill{background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;font-size:13px}.panel{margin-top:16px;padding:18px;border:1px solid #1b3548;border-radius:18px;background:#0b1823}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.btn{appearance:none;border:1px solid #2d5874;background:#12324a;color:white;border-radius:14px;padding:14px 12px;font-weight:700;font-size:15px;cursor:pointer}.btn:active{transform:scale(.98)}.btn.primary{background:#15506f;border-color:#4e9dca}.btn.choice{background:#0d2231}.btn.choice.selected{background:#166485;border-color:#7bcdf5;box-shadow:0 0 0 2px #55b9e633}.field,select,textarea{width:100%;background:#07131d;color:white;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}label{display:block;color:#9fb4c3;font-size:13px;margin:12px 0 6px}.status{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:60px;overflow:auto}.device{display:flex;justify-content:space-between;gap:12px;align-items:center}.ok{color:#6ef0ab}.bad{color:#ff9d8f}.check{display:flex;gap:10px;align-items:center;margin-top:12px;color:#c6d7e3}.check input{width:20px;height:20px}.hint{font-size:12px;color:#7894a7}.assign-card{margin-top:14px;padding:14px;border:1px solid #24445b;border-radius:16px;background:#091621}.assign-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.step-title{font-size:13px;color:#9fb4c3;margin:12px 0 7px}.choice-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.choice-grid .btn{padding:11px 8px;font-size:13px}.cell{display:block;font-size:11px;color:#8db2c8;margin-top:4px}.summary{margin-top:10px;color:#bfe7ff;font-size:13px}@media(max-width:600px){.wrap{padding:14px}.hero{padding:18px}h1{font-size:24px}.choice-grid{grid-template-columns:1fr}.choice-grid .btn{text-align:left;padding:12px 14px}}
  </style></head><body><main class="wrap"><section class="hero"><h1>JARVIS Commander</h1><p class="sub">MacBook・ZBook・iPhoneから登録済みAndroidを直接操作</p><div class="row"><span id="broker" class="pill">Broker確認中</span><span id="count" class="pill">端末 0</span></div></section>
  <section class="panel"><div class="device"><div><strong>操作する端末</strong><div id="deviceDetail" class="sub">読み込み中</div></div><button class="btn" onclick="refresh()">更新</button></div><label>端末</label><select id="device"></select></section>
  <section class="panel"><strong>クイック操作</strong><div class="grid" style="margin-top:12px"><button class="btn" onclick="send('wake-device',{})">画面を起こす</button><button class="btn" onclick="send('device-status',{})">端末状態</button><button class="btn primary" onclick="document.getElementById('assignments').scrollIntoView({behavior:'smooth'})">金魚・QR割当</button><button class="btn" onclick="send('open-app',{packageName:'com.android.chrome'})">Chrome</button><button class="btn" onclick="send('open-app',{packageName:'com.google.android.apps.maps'})">Google Maps</button><button class="btn" onclick="send('launch-settings',{screen:'wifi'})">Wi-Fi設定</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'home'}]})">ホーム</button><button class="btn" onclick="send('ui-sequence',{steps:[{action:'back'}]})">戻る</button></div></section>
  <section id="assignments" class="panel"><strong>端末別 TikTok Lite 作業割当</strong><p class="sub">各端末ごとに①金魚候補、②その後に押すQR候補を指定できます。1段目が成功しない限り2段目へ進みません。</p><div id="assignmentList"></div><button class="btn primary" style="margin-top:14px;width:100%" onclick="runAssigned()">割当済み端末をまとめて実行</button></section>
  <section id="sheetTask" class="panel"><strong>自由指定のスプレッドシート作業</strong><p class="sub">従来どおり、任意の表示文字を順番指定したい場合はこちら。</p><label>ファイル名</label><input id="sheetFile" class="field" value="TikTok Lite"><label>押す項目（1行に1つ、上から順番）</label><textarea id="sheetTargets" rows="5" placeholder="例：\n春巻QR\n5~56サッカー\nなおきQR"></textarea><label class="check"><input id="sheetBack" type="checkbox">各項目を押したあと「戻る」を1回実行</label><button class="btn" style="margin-top:12px;width:100%" onclick="spreadsheetTask()">自由指定で実行</button></section>
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
  function escapeHtml(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replaceAll(String.fromCharCode(34),'&quot;').replaceAll("'",'&#39;')}
  function detail(){const n=fleet.find(x=>x.id===target());document.getElementById('deviceDetail').textContent=n?((n.label||n.id)+' / '+n.status+' / '+(n.telemetry?.batteryPercent??'?')+'%'):'端末なし'}document.getElementById('device').addEventListener('change',detail)
  function show(x){document.getElementById('status').textContent=typeof x==='string'?x:JSON.stringify(x,null,2);document.getElementById('status').scrollIntoView({behavior:'smooth',block:'center'})}
  function ensureAssignment(id){if(!assignments[id])assignments[id]={first:'',second:''};return assignments[id]}
  function buttons(id,stage,table){const selected=ensureAssignment(id)[stage];return Object.entries(table).map(([key,item])=>'<button class="btn choice '+(selected===key?'selected':'')+'" data-id="'+escapeHtml(id)+'" data-stage="'+stage+'" data-key="'+key+'" onclick="setAssignment(this.dataset.id,this.dataset.stage,this.dataset.key)">'+escapeHtml(item.label)+'<span class="cell">'+escapeHtml(item.cell)+'</span></button>').join('')}
  function renderAssignments(){const root=document.getElementById('assignmentList');if(!fleet.length){root.innerHTML='<p class="sub">登録端末がありません</p>';return}root.innerHTML=fleet.map(n=>{const a=ensureAssignment(n.id);const summary=a.first&&a.second?(FIRST[a.first].label+' → '+SECOND[a.second].label):'未割当';return '<div class="assign-card"><div class="assign-title"><div><strong>'+escapeHtml(n.label||n.id)+'</strong><div class="hint">'+escapeHtml(n.status||'unknown')+' / '+escapeHtml(n.id.slice(0,8))+'</div></div><button class="btn" data-id="'+escapeHtml(n.id)+'" onclick="runOne(this.dataset.id)">この端末だけ実行</button></div><div class="step-title">① 最初に押す候補</div><div class="choice-grid">'+buttons(n.id,'first',FIRST)+'</div><div class="step-title">② ①が通った後に押す候補</div><div class="choice-grid">'+buttons(n.id,'second',SECOND)+'</div><div class="summary">割当: '+escapeHtml(summary)+'</div></div>'}).join('')}
  function setAssignment(id,stage,key){ensureAssignment(id)[stage]=key;renderAssignments()}
  async function runOne(id){const a=ensureAssignment(id);if(!a.first||!a.second)return show('この端末は①と②の両方を選んでください');try{show('端末タスクを送信中…');const b=await api('/api/preset-flow',{method:'POST',body:JSON.stringify({targetNodeId:id,firstChoice:a.first,secondChoice:a.second})});show('受付完了 ✅\n'+b.message+'\n\n1段目成功 → 必要ならシートへ戻る → 2段目、の順で進みます。')}catch(e){show('エラー: '+e.message)}}
  async function runAssigned(){const list=Object.entries(assignments).filter(([,a])=>a.first&&a.second).map(([targetNodeId,a])=>({targetNodeId,firstChoice:a.first,secondChoice:a.second}));if(!list.length)return show('①と②を割り当てた端末がありません');try{show(list.length+'台へタスクを送信中…');const b=await api('/api/preset-batch',{method:'POST',body:JSON.stringify({assignments:list})});show('一括受付完了 ✅\n'+b.message+'\n\n各端末がそれぞれ指定された① → ②の順で動きます。')}catch(e){show('エラー: '+e.message)}}
  async function send(type,payload){try{show('タスク送信中…');const b=await api('/api/task',{method:'POST',body:JSON.stringify({type,payload,targetNodeId:target(),idempotencyKey:type+':'+Date.now()})});const task=b.task||b;show('受付完了 ✅\n'+type+' をAndroidへ送信しました。\n状態: '+(task.status||'queued')+'\nタスクID: '+(task.id||'取得中'));setTimeout(refresh,1200)}catch(e){show('エラー: '+e.message)}}
  async function spreadsheetTask(){try{const node=target();if(!node)return show('操作する端末がありません');const fileName=document.getElementById('sheetFile').value.trim()||'TikTok Lite';const targets=document.getElementById('sheetTargets').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const backAfterEach=document.getElementById('sheetBack').checked;show('スプレッドシート作業を準備中…');const b=await api('/api/spreadsheet-flow',{method:'POST',body:JSON.stringify({targetNodeId:node,fileName,targets,backAfterEach})});show('タスク受付完了 ✅\n'+b.message+'\n\nSheets起動 → ファイル確認 → 指定項目を順番に実行します。')}catch(e){show('エラー: '+e.message)}}
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
    if (request.method === "POST" && url.pathname === "/api/preset-flow") {
      const payload = await readJson(request) as Record<string, unknown>;
      return json(response, 201, await enqueuePresetFlow(payload));
    }
    if (request.method === "POST" && url.pathname === "/api/preset-batch") {
      const payload = await readJson(request) as Record<string, unknown>;
      return json(response, 201, await enqueuePresetBatch(payload));
    }
    return json(response, 404, { message: "not found" });
  } catch (error) {
    return json(response, 500, {
      message: error instanceof Error ? error.message : "internal error",
      trace: createHash("sha256").update(String(error)).digest("hex").slice(0, 12),
    });
  }
}).listen(port, host, () => console.log(`[jarvis-direct-commander] listening on http://${host}:${port}`));