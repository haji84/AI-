import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath=new URL('./jarvis-direct-commander-v5.mjs',import.meta.url);
let source=readFileSync(sourcePath,'utf8');
const before="function auth(req,u){return same(typeof req.headers['x-jarvis-commander-key']==='string'?req.headers['x-jarvis-commander-key']:(u.searchParams.get('key')||''),KEY)}";
const after="function auth(req,u){const pathKey=u.pathname.startsWith('/c/')?decodeURIComponent(u.pathname.slice(3)):'';return same(typeof req.headers['x-jarvis-commander-key']==='string'?req.headers['x-jarvis-commander-key']:(u.searchParams.get('key')||pathKey),KEY)}";
if(!source.includes(before)) throw new Error('Commander v5 auth patch target not found');
source=source.replace(before,after);
const out=join(tmpdir(),`jarvis-direct-commander-v5-${process.pid}.mjs`);
writeFileSync(out,source,{mode:0o600});
await import(pathToFileURL(out).href);
