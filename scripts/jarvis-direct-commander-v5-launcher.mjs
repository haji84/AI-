import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath=new URL('./jarvis-direct-commander-v5.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');

function replaceOrThrow(before,after,label){
  if(!source.includes(before)) throw new Error(`Commander v5 ${label} patch target not found`);
  source=source.replace(before,after);
}

replaceOrThrow(
  "function auth(req,u){return same(typeof req.headers['x-jarvis-commander-key']==='string'?req.headers['x-jarvis-commander-key']:(u.searchParams.get('key')||''),KEY)}",
  "function auth(req,u){const p=u.pathname.split('/');const pathKey=(p[1]==='c'||p[1]==='e')&&p[2]?decodeURIComponent(p[2]):'';return same(typeof req.headers['x-jarvis-commander-key']==='string'?req.headers['x-jarvis-commander-key']:(u.searchParams.get('key')||pathKey),KEY)}",
  'auth',
);

replaceOrThrow(
  '10分有効の登録URLをワンタップで発行します。',
  'この固定URLは何度でも使えます。開くたびに10分有効・1台限りの登録権限を自動発行します。',
  'enrollment copy',
);
replaceOrThrow(
  '＋ 新しい端末を追加',
  '固定の端末追加URLを開く',
  'enrollment button',
);
replaceOrThrow(
  "$('new').onclick=enroll;load();refresh();setInterval(refresh,5000);",
  "const fixedEnrollUrl=location.origin+'/e/'+encodeURIComponent(key);$('enroll').className='show';$('url').textContent=fixedEnrollUrl;$('open').onclick=()=>window.open(fixedEnrollUrl,'_blank');$('copy').onclick=async()=>{await navigator.clipboard.writeText(fixedEnrollUrl);show('固定URLをコピーしました ✅')};$('renew').style.display='none';$('exp').textContent='固定URLです。開くたびに新しい10分有効・1台限りの登録権限を自動発行します。';$('new').onclick=()=>window.open(fixedEnrollUrl,'_blank');load();refresh();setInterval(refresh,5000);",
  'page initialization',
);

replaceOrThrow(
  "if(u.pathname.startsWith('/c/')){if(!auth(req,u))return json(res,403,{message:'forbidden'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(PAGE)}if(!auth(req,u))",
  "if(u.pathname.startsWith('/e/')){if(!auth(req,u))return json(res,403,{message:'forbidden'});if(req.method!=='GET')return json(res,405,{message:'method not allowed'});const x=await broker('/api/jarvis/admin/enrollment',{method:'POST',body:JSON.stringify({mode:'quick',ttlMs:600000,maxDevices:1,group:'default'})});if(!x.oneTapUrl)return json(res,503,{message:'公開Broker URLが未設定です'});res.writeHead(302,{Location:x.oneTapUrl,'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer'});return res.end()}if(u.pathname.startsWith('/c/')){if(!auth(req,u))return json(res,403,{message:'forbidden'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(PAGE)}if(!auth(req,u))",
  'fixed enrollment route',
);

const out=join(tmpdir(),`jarvis-direct-commander-v5-${process.pid}.mjs`);
writeFileSync(out,source,{mode:0o600});
await import(pathToFileURL(out).href);
