import { createServer } from 'node:http';
import { networkInterfaces, homedir } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = process.env.JARVIS_COMMANDER_HOST || '0.0.0.0';
const PORT = Number(process.env.JARVIS_COMMANDER_PORT || 8790);
const BROKER = (process.env.JARVIS_COMMANDER_BROKER || 'http://127.0.0.1:8787').replace(/\/$/, '');
const OWNER = (process.env.JARVIS_OWNER_TOKEN || '').trim();
const KEY = (process.env.JARVIS_COMMANDER_KEY || '').trim();
const STATE_ROOT = process.env.JARVIS_STATE_ROOT || join(homedir(), 'Library', 'Application Support', 'JARVIS');
if (!OWNER || !KEY) throw new Error('JARVIS_OWNER_TOKEN and JARVIS_COMMANDER_KEY are required');

const FIRST = {
  right: { label: '右翼金魚', cell: 'C7', clickText: '床掘はちみつ' },
  spring: { label: '春巻き金魚', cell: 'G7', clickText: '春巻きプニさん' },
  poi: { label: 'ポイ活金魚', cell: 'J7', clickText: 'ポイ活くんハチミツ' },
};
const SECOND = {
  right: { label: '右翼QR', cell: 'C5', clickText: 'オオグンタマQR' },
  spring: { label: '春巻きQR', cell: 'G6', clickText: '春巻QR' },
  poi: { label: 'ポイ活QR', cell: 'J6', clickText: 'ポイ活くんQR' },
};

function equal(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
function requestKey(req, url) {
  const header = req.headers['x-jarvis-commander-key'];
  if (typeof header === 'string' && header) return header;
  return url.searchParams.get('key') || '';
}
function authorized(req, url) { return equal(requestKey(req, url), KEY); }
function hostName(value) {
  const v = String(value || '').toLowerCase();
  if (v.startsWith('[')) return v.slice(1, v.indexOf(']'));
  return v.split(':')[0];
}
function privateHost(value) {
  const h = hostName(value);
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  return !!(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}
function fallbackLanIp() {
  const all = networkInterfaces();
  for (const list of Object.values(all)) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)) return n.address;
  }
  return '127.0.0.1';
}
function readStateUrl(name) {
  const path = join(STATE_ROOT, name);
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf8').trim(); } catch { return ''; }
}
function accessInfo() {
  const savedLan = readStateUrl('commander-lan-url.txt');
  const publicUrl = readStateUrl('commander-url.txt');
  const lanUrl = savedLan || `http://${fallbackLanIp()}:${PORT}/c/${encodeURIComponent(KEY)}`;
  return { lanUrl, publicUrl: publicUrl || null };
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function text(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > 200000) throw new Error('body too large');
    chunks.push(b);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
async function broker(path, init = {}) {
  const r = await fetch(BROKER + path, { ...init, headers: { Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const raw = await r.text();
  let body = raw;
  try { body = raw ? JSON.parse(raw) : {}; } catch {}
  if (!r.ok) throw new Error(body && typeof body === 'object' && body.message ? String(body.message) : `Broker HTTP ${r.status}`);
  return body;
}
function task(type, payload, node, suffix, priority = 'normal') {
  return { type, payload, targetNodeId: node, priority, idempotencyKey: `${type}:${Date.now()}:${suffix}` };
}
async function choiceFlow(input) {
  const node = String(input.targetNodeId || '').trim();
  const first = FIRST[String(input.firstChoice || '')];
  const second = SECOND[String(input.secondChoice || '')];
  if (!node || !first || !second) throw new Error('端末または選択内容が不正です');
  const openTask = await broker('/api/jarvis/admin/tasks', { method: 'POST', body: JSON.stringify(task('open-app', { packageName: 'com.google.android.apps.docs.editors.sheets' }, node, 'sheet-open', 'high')) });
  const steps = [
    { action: 'wait', ms: 1200 },
    { action: 'ensure-open-text', text: 'TikTok Lite', timeoutMs: 8000 },
    { action: 'wait', ms: 1200 },
    { action: 'click-text-retry', text: first.clickText, timeoutMs: 7000 },
    { action: 'wait', ms: 2500 },
    { action: 'back' },
    { action: 'wait', ms: 1200 },
    { action: 'click-text-retry', text: second.clickText, timeoutMs: 7000 },
    { action: 'wait', ms: 2500 },
    { action: 'home' },
  ];
  const sequenceTask = await broker('/api/jarvis/admin/tasks', { method: 'POST', body: JSON.stringify(task('ui-sequence', { steps }, node, 'sheet-flow', 'high')) });
  return { accepted: true, first, second, stages: [openTask, sequenceTask] };
}

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><title>JARVIS Commander</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071019;color:#eef7ff}.wrap{max-width:980px;margin:auto;padding:20px}.hero,.panel{border:1px solid #24445b;border-radius:20px;background:#0b1823;padding:18px;margin-top:14px}.hero{background:linear-gradient(145deg,#102637,#071019)}h1{margin:0;font-size:28px}.sub,.hint{color:#91aabd;line-height:1.5}.grid,.choiceGrid,.rangeGrid{display:grid;gap:10px}.grid,.choiceGrid{grid-template-columns:repeat(3,1fr)}.rangeGrid{grid-template-columns:100px 100px 1fr 1fr}.btn,.choiceBtn{border:1px solid #2d5874;background:#12324a;color:#fff;border-radius:14px;padding:13px;font-weight:700;font-size:15px;cursor:pointer}.btn.primary,.choiceBtn.selected{background:#0b6a54;border-color:#71efbd}.field,select{width:100%;background:#07131d;color:#fff;border:1px solid #29465a;border-radius:12px;padding:12px;font-size:15px}.pill{display:inline-block;background:#0e2738;border:1px solid #28516d;border-radius:999px;padding:7px 12px;margin:8px 8px 0 0}.assignment{border:1px solid #24445b;border-radius:14px;padding:12px;margin-top:10px}.status,.share{white-space:pre-wrap;background:#061019;border-radius:12px;padding:12px;color:#bfe7ff;min-height:50px}.share{word-break:break-all;margin-top:10px}.share a{color:#8fd7ff}.ok{color:#6ef0ab}.bad{color:#ff9d8f}.warn{color:#ffd37a}@media(max-width:700px){.wrap{padding:12px}.grid,.choiceGrid,.rangeGrid{grid-template-columns:1fr}.rangeGrid{grid-template-columns:1fr 1fr}h1{font-size:24px}}
</style></head><body><main class="wrap"><section class="hero"><h1>JARVIS Commander</h1><p class="sub">認証済みAndroid端末をMacBook・iPhone・Windows PCから操作</p><span id="broker" class="pill">接続確認中</span><span id="count" class="pill">端末 0</span><div id="lanUrl" class="share">接続URLを確認中…</div></section><section class="panel"><strong>クイック操作端末</strong><select id="device"></select><div class="grid" style="margin-top:10px"><button id="wake" class="btn">画面を起こす</button><button id="home" class="btn">ホーム</button><button id="wifi" class="btn">Wi-Fi設定</button></div><button id="probe" class="btn" style="width:100%;margin-top:10px">接続テスト</button></section><section class="panel"><strong>範囲で一括設定</strong><p class="sub">1〜20など端末番号の範囲に作業を割り当てます。</p><div class="rangeGrid"><input id="start" class="field" type="number" min="1" value="1"><input id="end" class="field" type="number" min="1" value="20"><select id="first"><option value="right">右翼金魚 C7</option><option value="spring">春巻き金魚 G7</option><option value="poi">ポイ活金魚 J7</option></select><select id="second"><option value="right">右翼QR C5</option><option value="spring" selected>春巻きQR G6</option><option value="poi">ポイ活QR J6</option></select></div><button id="apply" class="btn primary" style="width:100%;margin-top:12px">この範囲に設定</button><button id="run" class="btn primary" style="width:100%;margin-top:10px">設定済み端末をまとめて実行</button></section><section class="panel"><strong>端末別設定</strong><div id="assignments"></div></section><section class="panel"><strong>実行結果</strong><pre id="status" class="status">起動中…</pre></section></main><script src="/commander-v3.js"></script></body></html>`;

const CLIENT = String.raw`"use strict";
const key=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
let fleet=[];let assignments={};
const FIRST={right:{label:'右翼金魚',cell:'C7'},spring:{label:'春巻き金魚',cell:'G7'},poi:{label:'ポイ活金魚',cell:'J7'}};
const SECOND={right:{label:'右翼QR',cell:'C5'},spring:{label:'春巻きQR',cell:'G6'},poi:{label:'ポイ活QR',cell:'J6'}};
const $=id=>document.getElementById(id);
const esc=v=>{const d=document.createElement('div');d.textContent=String(v);return d.innerHTML;};
const show=v=>{$('status').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);};
const numberOf=n=>{const m=String(n.label||'').match(/(\d+)(?!.*\d)/);return m?Number(m[1]):null;};
async function api(path,opt={}){const r=await fetch(path,{...opt,cache:'no-store',headers:{'X-JARVIS-Commander-Key':key,...(opt.headers||{})}});const raw=await r.text();let b;try{b=raw?JSON.parse(raw):{};}catch{b={message:raw};}if(!r.ok)throw new Error(b.message||('HTTP '+r.status));return b;}
function save(){try{localStorage.setItem('jarvisAssignmentsV3',JSON.stringify(assignments));}catch{}}
function load(){try{assignments=JSON.parse(localStorage.getItem('jarvisAssignmentsV3')||'{}')||{};}catch{assignments={};}}
function target(){return $('device').value||'';}
async function state(){return api('/api/state');}
async function refresh(){try{const s=await state();fleet=Array.isArray(s.fleet)?s.fleet:[];$('broker').textContent='Broker 接続中';$('broker').className='pill ok';$('count').textContent='端末 '+fleet.length;const keep=$('device').value;$('device').innerHTML=fleet.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.label||n.id)+' · '+esc(n.status||'unknown')+'</option>').join('');if(keep&&fleet.some(n=>n.id===keep))$('device').value=keep;render();if($('status').textContent==='起動中…')show('操作可能 ✅');}catch(e){$('broker').textContent='Broker エラー';$('broker').className='pill bad';show('接続エラー: '+e.message);}}
async function accessInfo(){try{const x=await api('/api/access-info');const parts=['LAN用: '+x.lanUrl];if(x.publicUrl)parts.push('外部用: '+x.publicUrl);else parts.push('外部用: 準備中またはトンネル未接続');$('lanUrl').textContent=parts.join('\n');}catch(e){$('lanUrl').textContent='URL取得失敗: '+e.message;}}
async function waitTask(id,label){const started=Date.now();let last='queued';while(Date.now()-started<20000){const s=await state();const t=(s.tasks||[]).find(x=>x.id===id);if(t){last=t.status;if(last==='completed')return show(label+' ✅\n状態: completed\n実機で完了を確認しました');if(last==='failed'||last==='cancelled')return show(label+' ❌\n状態: '+last);if(last==='running'||last==='leased')show(label+' 実行中…\n状態: '+last);else show(label+' 受付済み\n状態: '+last+'\nWorkerの受信待ち');}await new Promise(r=>setTimeout(r,1000));}show(label+' ⚠️\n20秒以内に完了確認できませんでした\n最終状態: '+last+'\n端末側Workerの常時接続を確認してください');}
async function send(type,payload,label){const node=target();if(!node)return show('操作する端末を選んでください');try{show(label+' を送信中…');const b=await api('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,targetNodeId:node,priority:'urgent',idempotencyKey:type+':'+Date.now()})});const t=b.task||b;show(label+' 受付完了 ✅\n状態: '+(t.status||'queued'));if(t.id)await waitTask(t.id,label);}catch(e){show(label+' 操作エラー: '+e.message);}}
function choose(node,stage,k){assignments[node]=assignments[node]||{};assignments[node][stage]=k;save();render();}
function buttons(node,stage,map){const cur=assignments[node]?.[stage];return Object.entries(map).map(([k,v])=>'<button class="choiceBtn '+(cur===k?'selected':'')+'" data-node="'+esc(node)+'" data-stage="'+stage+'" data-key="'+k+'">'+esc(v.label)+'<br><small>'+esc(v.cell)+'</small></button>').join('');}
function render(){const root=$('assignments');if(!fleet.length){root.innerHTML='<p class="sub">登録端末なし</p>';return;}const sorted=[...fleet].sort((a,b)=>(numberOf(a)??999999)-(numberOf(b)??999999));root.innerHTML=sorted.map(n=>{const a=assignments[n.id]||{};const num=numberOf(n);const summary=a.first&&a.second?FIRST[a.first].label+' → '+SECOND[a.second].label:'未設定';return '<div class="assignment"><strong>'+(num!==null?'#'+num+' ':'')+esc(n.label||n.id)+'</strong><div class="hint">'+esc(n.status||'unknown')+'</div><div class="choiceGrid" style="margin-top:8px">'+buttons(n.id,'first',FIRST)+'</div><div class="choiceGrid" style="margin-top:8px">'+buttons(n.id,'second',SECOND)+'</div><div style="margin-top:8px">'+esc(summary)+'</div></div>';}).join('');root.querySelectorAll('.choiceBtn').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.node,b.dataset.stage,b.dataset.key)));}
function apply(){const s=Number($('start').value),e=Number($('end').value),f=$('first').value,q=$('second').value;if(!Number.isInteger(s)||!Number.isInteger(e)||s<1||e<s)return show('範囲を確認してください');let c=0;for(const n of fleet){const num=numberOf(n);if(num!==null&&num>=s&&num<=e){assignments[n.id]={first:f,second:q};c++;}}save();render();show(s+'〜'+e+'番の '+c+'台を設定しました');}
async function waitStageTasks(stages,label){for(const stage of stages||[]){const t=stage.task||stage;if(t&&t.id)await waitTask(t.id,label);}}
async function run(){const jobs=fleet.filter(n=>assignments[n.id]?.first&&assignments[n.id]?.second);if(!jobs.length)return show('実行設定された端末がありません');show(jobs.length+'台へタスク送信中…');const out=[];for(const n of jobs){const a=assignments[n.id];try{const b=await api('/api/spreadsheet-choice-flow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetNodeId:n.id,firstChoice:a.first,secondChoice:a.second})});out.push('✅ '+(n.label||n.id)+': 受付完了');await waitStageTasks(b.stages,n.label||n.id);}catch(e){out.push('❌ '+(n.label||n.id)+': '+e.message);}}show(out.join('\n'));}
function boot(){load();$('wake').addEventListener('click',()=>send('wake-device',{},'画面を起こす'));$('home').addEventListener('click',()=>send('ui-sequence',{steps:[{action:'home'}]},'ホーム'));$('wifi').addEventListener('click',()=>send('launch-settings',{screen:'wifi'},'Wi-Fi設定'));$('probe').addEventListener('click',()=>send('device-status',{},'接続テスト'));$('apply').addEventListener('click',apply);$('run').addEventListener('click',run);refresh();accessInfo();setInterval(refresh,3000);setInterval(accessInfo,10000);}
window.addEventListener('error',e=>show('画面エラー: '+e.message));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'jarvis-direct-commander-v3', host: HOST, port: PORT });
    if (req.method === 'GET' && url.pathname === '/' && privateHost(req.headers.host)) {
      res.writeHead(302, { Location: `/c/${encodeURIComponent(KEY)}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === `/c/${encodeURIComponent(KEY)}`) return text(res, 200, 'text/html', PAGE);
    if (req.method === 'GET' && url.pathname === '/commander-v3.js') return text(res, 200, 'text/javascript', CLIENT);
    if (!authorized(req, url)) return json(res, 401, { message: 'commander access denied' });
    if (req.method === 'GET' && url.pathname === '/api/access-info') return json(res, 200, accessInfo());
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, await broker('/api/jarvis/admin/state'));
    if (req.method === 'POST' && url.pathname === '/api/task') return json(res, 201, await broker('/api/jarvis/admin/tasks', { method: 'POST', body: JSON.stringify(await readJson(req)) }));
    if (req.method === 'POST' && url.pathname === '/api/spreadsheet-choice-flow') return json(res, 201, await choiceFlow(await readJson(req)));
    return json(res, 404, { message: 'not found' });
  } catch (error) {
    return json(res, 500, { message: error instanceof Error ? error.message : 'internal error' });
  }
}).listen(PORT, HOST, () => console.log(`[jarvis-direct-commander-v3] listening on http://${HOST}:${PORT}`));
