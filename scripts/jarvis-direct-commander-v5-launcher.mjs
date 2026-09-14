import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Commander v5 intentionally reuses the proven v4.1 UI and behavior.
// v5 adds only the fixed device-enrollment entry point so button placement
// and existing controls stay where users already expect them.
const sourcePath=new URL('./jarvis-direct-commander-v4.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

function replaceOrThrow(before,after,label){
  if(!source.includes(before)) throw new Error(`Commander v5 ${label} patch target not found`);
  source=source.replace(before,after);
}

replaceOrThrow(
  "function reqKey(req,url){const h=req.headers['x-jarvis-commander-key'];return typeof h==='string'&&h?h:(url.searchParams.get('key')||'')}",
  "function reqKey(req,url){const h=req.headers['x-jarvis-commander-key'];if(typeof h==='string'&&h)return h;const p=url.pathname.split('/');const pathKey=(p[1]==='c'||p[1]==='e')&&p[2]?decodeURIComponent(p[2]):'';return url.searchParams.get('key')||pathKey}",
  'path auth',
);

replaceOrThrow(
  '<h1>JARVIS Commander v4.1</h1><p class="sub">セル指定リンク対応</p>',
  '<h1>JARVIS Commander v5</h1><p class="sub">セル指定リンク対応</p>',
  'title',
);

replaceOrThrow(
  '</section><section class="panel"><strong>クイック操作</strong>',
  '</section><section class="panel"><strong>新しい端末を追加</strong><p class="sub">固定URL方式です。ボタンを押すたびに裏で10分有効・1台限りの登録権限を新しく発行します。</p><button id="addDevice" class="btn primary" style="width:100%">＋ 新しい端末を追加</button></section><section class="panel"><strong>クイック操作</strong>',
  'device-add panel',
);

replaceOrThrow(
  "function boot(){load();$('wake').onclick=()=>send('wake-device',{},'画面を起こす');",
  "function boot(){load();$('addDevice').onclick=()=>window.open(location.origin+'/e/'+encodeURIComponent(key),'_blank');$('wake').onclick=()=>send('wake-device',{},'画面を起こす');",
  'device-add action',
);

replaceOrThrow(
  "if(req.method==='GET'&&url.pathname===`/c/${encodeURIComponent(KEY)}`)return text(res,200,'text/html',PAGE);if(req.method==='GET'&&url.pathname==='/commander-v4.js')return text(res,200,'text/javascript',CLIENT);if(!auth(req,url))",
  "if(req.method==='GET'&&url.pathname.startsWith('/e/')){if(!auth(req,url))return json(res,401,{message:'commander access denied'});const x=await broker('/api/jarvis/admin/enrollment',{method:'POST',body:JSON.stringify({mode:'quick',ttlMs:600000,maxDevices:1,group:'default'})});if(!x.oneTapUrl)return json(res,503,{message:'公開Broker URLが未設定です'});res.writeHead(302,{Location:x.oneTapUrl,'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer'});return res.end()}if(req.method==='GET'&&url.pathname===`/c/${encodeURIComponent(KEY)}`)return text(res,200,'text/html',PAGE);if(req.method==='GET'&&url.pathname==='/commander-v4.js')return text(res,200,'text/javascript',CLIENT);if(!auth(req,url))",
  'fixed enrollment route',
);

replaceOrThrow(
  "service:'jarvis-direct-commander-v4'",
  "service:'jarvis-direct-commander-v5'",
  'health version',
);
replaceOrThrow(
  "[jarvis-direct-commander-v4] listening on",
  "[jarvis-direct-commander-v5] listening on",
  'log version',
);

const out=join(tmpdir(),`jarvis-direct-commander-v5-${process.pid}.mjs`);
writeFileSync(out,source,{mode:0o600});
await import(pathToFileURL(out).href);
