import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";

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

function cookieValue(request: IncomingMessage, name: string) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function keyFrom(request: IncomingMessage, url: URL) {
  const header = request.headers["x-jarvis-commander-key"];
  if (typeof header === "string" && header) return header;
  const query = url.searchParams.get("key");
  if (query) return query;
  return cookieValue(request, "jarvis_commander");
}

function authorized(request: IncomingMessage, url: URL) {
  return safeEqual(keyFrom(request, url), accessKey);
}

function hostNameOnly(value: string) {
  const hostHeader = value.trim().toLowerCase();
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end >= 0 ? hostHeader.slice(1, end) : hostHeader;
  }
  return hostHeader.split(":")[0];
}

function isPrivateHost(value: string) {
  const name = hostNameOnly(value);
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") return true;
  if (/^10\./.test(name) || /^192\.168\./.test(name)) return true;
  const match = name.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function preferredLanIp() {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) return entry.address;
    }
  }
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, status: number, body: string, setCookie = false) {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  };
  if (setCookie) {
    headers["Set-Cookie"] = `jarvis_commander=${encodeURIComponent(accessKey)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
  }
  response.writeHead(status, headers);
  response.end(body);
}

function javascript(response: ServerResponse, body: string) {
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
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
  const first = firstChoices[firstKey];
  const second = secondChoices[secondKey];
  const packageName = "com.google.android.apps.docs.editors.sheets";

  const openTask = await brokerFetch("/api/jarvis/admin/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody("open-app", { packageName }, targetNodeId, "sheet-open")),
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
    method: "POST",
    body: JSON.stringify(taskBody("ui-sequence", { steps }, targetNodeId, "sheet-choice-sequence")),
  });
  return {
    accepted: true,
    first: { key: firstKey, label: first.label, cell: first.cell },
    second: { key: secondKey, label: second.label, cell: second.cell },
    message: `${first.label}（${first.cell}）→ スプレッドシートへ戻る → ${second.label}（${second.cell}）→ ホームへ戻る`,
    stages: [openTask, sequenceTask],
  };
}

function page() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:980px;margin:auto;padding:20px}.hero,.panel{border:1px solid #24445b;border-radius:20px;background:#0b1823;padding:18px;margin-top:14px}.hero{background:linear-gradient(145deg,#102637,#071019)}h1{margin:0;font-size:28px}.sub,.hint{color:#91aabd;line-height:1.5}.grid,.choiceGrid,.rangeGrid{display:grid;gap:10px}.grid,.choiceGrid{grid-template-columns:repeat(3,1fr)}.rangeGrid{grid-template-columns:100px 100px 1fr 1fr}.btn,.choiceBtn{border:1px solid #2d5874;background:#12324a;color:white;border-radius:14px;padding:13px;font-weight:700;font-size:15px;cursor:pointer}.btn:disabled,.choiceBtn:disabled{opacity:.45;cursor:not-allowed}.btn.primary,.choiceBtn.selected{background:#0b6a54;border-color:#71efbd}.field,select{width:100%;background:#07131d;color:white;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}.pill{display:inline-block;background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;margin:8px 8px 0 0}.assignment{border:1px solid #24445b;border-radius:14px;padding:12px;margin-top:10px}.summary{margin-top:9px;color:#c8dce9}.status{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:70px}.ok{color:#6ef0ab}.bad{color:#ff9d8f}.share{word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#061019;border-radius:10px;padding:10px;margin-top:8px}@media(max-width:700px){.wrap{padding:12px}.grid,.choiceGrid,.rangeGrid{grid-template-columns:1fr}.rangeGrid{grid-template-columns:1fr 1fr}h1{font-size:24px}}
  </style></head><body><main class="wrap">
  <section class="hero"><h1>JARVIS Commander</h1><p class="sub">認証済みAndroid端末をMacBook・iPhone・Windows PCから操作</p><span id="broker" class="pill">Broker確認中</span><span id="count" class="pill">端末 0</span><div id="lanUrl" class="share">他端末用URLを確認中…</div></section>
  <section class="panel"><strong>クイック操作</strong><label for="device">端末</label><select id="device"></select><div class="grid" style="margin-top:10px"><button id="wakeBtn" class="btn">画面を起こす</button><button id="homeBtn" class="btn">ホーム</button><button id="wifiBtn" class="btn">Wi-Fi設定</button></div></section>
  <section class="panel"><strong>範囲で一括設定</strong><p class="sub">例：1〜20を「右翼金魚 → 春巻きQR」に設定。1段目→戻る→2段目→ホームまで自動で流します。</p><div class="rangeGrid"><div><label for="rangeStart">開始</label><input id="rangeStart" class="field" type="number" min="1" value="1"></div><div><label for="rangeEnd">終了</label><input id="rangeEnd" class="field" type="number" min="1" value="20"></div><div><label for="rangeFirst">最初</label><select id="rangeFirst"><option value="right">右翼金魚 C7</option><option value="spring">春巻き金魚 G7</option><option value="poi">ポイ活金魚 J7</option></select></div><div><label for="rangeSecond">次</label><select id="rangeSecond"><option value="right">右翼QR C5</option><option value="spring" selected>春巻きQR G6</option><option value="poi">ポイ活QR J6</option></select></div></div><button id="applyRangeBtn" class="btn primary" style="width:100%;margin-top:12px">この範囲に設定</button><button id="runConfiguredBtn" class="btn primary" style="width:100%;margin-top:10px">設定済み端末をまとめて実行</button></section>
  <section class="panel"><strong>端末別設定</strong><div id="assignmentList"></div></section>
  <section class="panel"><strong>実行結果</strong><pre id="status" class="status">起動中…</pre></section>
  </main><script src="/commander.js"></script></body></html>`;
}

function commanderScript() {
  return `"use strict";
var fleet=[];
var assignments={};
var FIRST={right:{label:"右翼金魚",cell:"C7"},spring:{label:"春巻き金魚",cell:"G7"},poi:{label:"ポイ活金魚",cell:"J7"}};
var SECOND={right:{label:"右翼QR",cell:"C5"},spring:{label:"春巻きQR",cell:"G6"},poi:{label:"ポイ活QR",cell:"J6"}};
function el(id){return document.getElementById(id);}
function esc(value){return String(value).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;"}[c];});}
function target(){return el("device").value||"";}
function deviceNumber(node){var m=String(node.label||"").match(/(\\d+)(?!.*\\d)/);return m?Number(m[1]):null;}
function show(value){el("status").textContent=typeof value==="string"?value:JSON.stringify(value,null,2);}
function saveAssignments(){try{localStorage.setItem("jarvisAssignments",JSON.stringify(assignments));}catch(_e){}}
function loadAssignments(){try{assignments=JSON.parse(localStorage.getItem("jarvisAssignments")||"{}");if(!assignments||typeof assignments!=="object")assignments={};}catch(_e){assignments={};}}
async function api(path,options){var r=await fetch(path,Object.assign({credentials:"same-origin"},options||{}));var t=await r.text();var body;try{body=t?JSON.parse(t):{};}catch(_e){body={message:t};}if(!r.ok)throw new Error(body.message||("HTTP "+r.status));return body;}
function setConnected(connected){el("broker").textContent=connected?"Broker 接続中":"Broker エラー";el("broker").className=connected?"pill ok":"pill bad";}
async function refresh(){try{var state=await api("/api/state");fleet=Array.isArray(state.fleet)?state.fleet:[];setConnected(true);el("count").textContent="端末 "+fleet.length;var select=el("device");var keep=select.value;select.innerHTML=fleet.map(function(n){return "<option value=\""+esc(n.id)+"\">"+esc(n.label||n.id)+" · "+esc(n.status||"unknown")+"</option>";}).join("");if(keep&&fleet.some(function(n){return n.id===keep;}))select.value=keep;renderAssignments();}catch(e){setConnected(false);show("接続エラー: "+e.message);}}
async function loadAccessInfo(){try{var info=await api("/api/access-info");el("lanUrl").textContent="iPhone / ZBook 用: "+info.lanUrl;}catch(e){el("lanUrl").textContent="他端末用URL取得失敗: "+e.message;}}
async function send(type,payload){var node=target();if(!node){show("操作する端末を選んでください");return;}try{var body=await api("/api/task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:type,payload:payload,targetNodeId:node,idempotencyKey:type+":"+Date.now()})});show("受付完了 ✅\\n"+type+"\\n状態: "+((body.task||body).status||"queued"));}catch(e){show("操作エラー: "+e.message);}}
function choose(node,stage,key){if(!assignments[node])assignments[node]={};assignments[node][stage]=key;saveAssignments();renderAssignments();}
function choiceButtons(node,stage,map){var current=assignments[node]&&assignments[node][stage];return Object.keys(map).map(function(key){var item=map[key];return "<button class=\"choiceBtn "+(current===key?"selected":"")+"\" data-node=\""+esc(node)+"\" data-stage=\""+stage+"\" data-key=\""+key+"\">"+esc(item.label)+"<br><small>"+esc(item.cell)+"</small></button>";}).join("");}
function renderAssignments(){var root=el("assignmentList");if(!fleet.length){root.innerHTML="<p class=\"sub\">登録端末なし</p>";return;}var sorted=fleet.slice().sort(function(a,b){var an=deviceNumber(a),bn=deviceNumber(b);return (an===null?999999:an)-(bn===null?999999:bn);});root.innerHTML=sorted.map(function(n){var a=assignments[n.id]||{};var num=deviceNumber(n);var summary=a.first&&a.second?FIRST[a.first].label+" → "+SECOND[a.second].label:"未設定";return "<div class=\"assignment\"><strong>"+(num!==null?"#"+num+" ":"")+esc(n.label||n.id)+"</strong><div class=\"hint\">"+esc(n.status||"unknown")+"</div><div class=\"choiceGrid\" style=\"margin-top:8px\">"+choiceButtons(n.id,"first",FIRST)+"</div><div class=\"choiceGrid\" style=\"margin-top:8px\">"+choiceButtons(n.id,"second",SECOND)+"</div><div class=\"summary\">"+esc(summary)+"</div></div>";}).join("");Array.prototype.forEach.call(root.querySelectorAll(".choiceBtn"),function(button){button.addEventListener("click",function(){choose(button.getAttribute("data-node"),button.getAttribute("data-stage"),button.getAttribute("data-key"));});});}
function applyRange(){var start=Number(el("rangeStart").value),end=Number(el("rangeEnd").value),first=el("rangeFirst").value,second=el("rangeSecond").value;if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start){show("範囲を確認してください");return;}var count=0;fleet.forEach(function(n){var num=deviceNumber(n);if(num!==null&&num>=start&&num<=end){assignments[n.id]={first:first,second:second};count++;}});saveAssignments();renderAssignments();show(start+"〜"+end+"番の "+count+"台を "+FIRST[first].label+" → "+SECOND[second].label+" に設定しました");}
async function runConfigured(){var jobs=fleet.filter(function(n){var a=assignments[n.id];return a&&a.first&&a.second;});if(!jobs.length){show("実行設定された端末がありません");return;}show(jobs.length+"台へタスク送信中…");var results=[];for(var i=0;i<jobs.length;i++){var n=jobs[i],a=assignments[n.id];try{var b=await api("/api/spreadsheet-choice-flow",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetNodeId:n.id,firstChoice:a.first,secondChoice:a.second})});results.push("✅ "+(n.label||n.id)+": "+b.first.label+" → "+b.second.label+" → 受付完了");}catch(e){results.push("❌ "+(n.label||n.id)+": "+e.message);}}show(results.join("\\n"));}
function boot(){loadAssignments();el("wakeBtn").addEventListener("click",function(){send("wake-device",{});});el("homeBtn").addEventListener("click",function(){send("ui-sequence",{steps:[{action:"home"}]});});el("wifiBtn").addEventListener("click",function(){send("launch-settings",{screen:"wifi"});});el("applyRangeBtn").addEventListener("click",applyRange);el("runConfiguredBtn").addEventListener("click",runConfigured);refresh();loadAccessInfo();setInterval(refresh,3000);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();`;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "jarvis-direct-commander", host, port });
    }
    if (request.method === "GET" && url.pathname === "/" && isPrivateHost(String(request.headers.host || ""))) {
      response.writeHead(302, { Location: `/c/${encodeURIComponent(accessKey)}`, "Cache-Control": "no-store" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === `/c/${encodeURIComponent(accessKey)}`) {
      return html(response, 200, page(), true);
    }
    if (!authorized(request, url)) return json(response, 401, { message: "commander access denied" });
    if (request.method === "GET" && url.pathname === "/commander.js") return javascript(response, commanderScript());
    if (request.method === "GET" && url.pathname === "/api/access-info") {
      const lanIp = preferredLanIp();
      return json(response, 200, { lanIp, lanUrl: `http://${lanIp}:${port}/` });
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(response, 200, await brokerFetch("/api/jarvis/admin/state"));
    }
    if (request.method === "POST" && url.pathname === "/api/task") {
      const payload = await readJson(request);
      return json(response, 201, await brokerFetch("/api/jarvis/admin/tasks", { method: "POST", body: JSON.stringify(payload) }));
    }
    if (request.method === "POST" && url.pathname === "/api/spreadsheet-choice-flow") {
      const payload = (await readJson(request)) as Record<string, unknown>;
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
