import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const source=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const posixQuote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
function guarded(home,relative) {
  const target=path.resolve(home,relative), rel=path.relative(home,target);
  if(rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('Path outside CODEX_HOME');
  let check=home;
  for(const part of ['',...rel.split(path.sep).filter(Boolean)]) {
    if(part) check=path.join(check,part);
    if(fs.existsSync(check)&&fs.lstatSync(check).isSymbolicLink()) throw new Error('Symlink in managed path');
  }
  return target;
}
function visibleLines(lines) {
  let quote=null;
  return lines.map(line=>{
    const visible=quote===null;
    for(let i=0;i<line.length;i++) {
      if(quote) {
        if(quote.startsWith('"')&&line[i]==='\\'){i++;continue;}
        if(line.startsWith(quote,i)){i+=quote.length-1;quote=null;}
      } else {
        if(line[i]==='#')break;
        if(line.startsWith('"""',i)||line.startsWith("'''",i)){quote=line.slice(i,i+3);i+=2;}
        else if(line[i]==='"'||line[i]==="'")quote=line[i];
      }
    }
    return visible;
  });
}
const tableName=line=>line.match(/^\s*\[\s*(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)')\s*\]\s*(?:#.*)?$/)?.slice(1).find(Boolean);
function parsedSettings(before,after=null) {
  const program=`import sys,json,tomllib\nx=json.load(sys.stdin.buffer)\na=tomllib.loads(x['before'])\nb=tomllib.loads(x['after']) if x['after'] is not None else None\nif b is not None:\n for d in (a,b):\n  for table,keys in [('agents',['enabled','max_concurrent_threads_per_session','max_threads','max_depth','interrupt_message']),('features',['hooks','multi_agent'])]:\n   if table in d:\n    for key in keys:d[table].pop(key,None)\n    if not d[table]:d.pop(table)\n if a!=b:raise ValueError('unmanaged setting changed')\n print('{}')\nelse:\n agents=a.get('agents',{})\n print(json.dumps({'cap':agents.get('max_concurrent_threads_per_session',agents.get('max_threads')),'bothCaps':'max_threads' in agents and 'max_concurrent_threads_per_session' in agents,'legacyMulti':a.get('features',{}).get('multi_agent'),'inlineHooks':any(k != 'state' for k in a.get('hooks',{}))}))`;
  for(const binary of ['python3','python']) {
    const r=spawnSync(binary,['-c',program],{input:JSON.stringify({before,after}),encoding:'utf8',timeout:5000,windowsHide:true,maxBuffer:16384});
    if(r.error?.code==='ENOENT')continue;
    if(r.status===0) return JSON.parse(r.stdout);
    if(r.stderr?.includes('No module named'))continue;
    throw new Error('TOML structural validation failed; user files were not changed');
  }
  throw new Error('Python 3.11+ with tomllib is required for safe TOML validation');
}
export function setToml(text, table, key, literal) {
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),visible=visibleLines(lines);
  let start=table===''?0:-1,end=lines.length;
  if(table!=='') start=lines.findIndex((line,i)=>visible[i]&&tableName(line)===table);
  if(start<0) {
    while(lines.at(-1)==='') lines.pop();
    lines.push('',`[${table}]`,`${key} = ${literal}`,'');return lines.join('\n');
  }
  for(let i=table===''?0:start+1;i<lines.length;i++) if(visible[i]&&/^\s*\[/.test(lines[i])) {end=i;break;}
  let found=false;
  for(let i=table===''?0:start+1;i<end;i++) if(visible[i]&&new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(lines[i])) {
    if(found) throw new Error('Duplicate managed TOML key');lines[i]=`${key} = ${literal}`;found=true;
  }
  if(!found) lines.splice(end,0,`${key} = ${literal}`);
  return lines.join('\n');
}
function readSmall(file,max=262144) {
  if(!fs.existsSync(file)) return null;
  if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>max) throw new Error('Unsafe or oversized input');
  return fs.readFileSync(file);
}
function installedFiles(home,original) {
  const files=new Map();
  const read=p=>fs.readFileSync(path.join(source,p));
  const before=original('config.toml')?.toString('utf8').replace(/^\uFEFF/,'')??'';
  let config=before;const settings=parsedSettings(before);
  if(settings.inlineHooks) throw new Error('Inline hooks exist; reconcile them before installing a second hook source');
  if(settings.bothCaps) throw new Error('Conflicting current and legacy agent caps');
  const previousCap=Number(settings.cap);
  const hardwareCap=Math.max(1,Math.min(6,Math.floor(os.totalmem()/2**30/8),Math.floor(os.availableParallelism()/4)));
  const cap=previousCap>0?Math.min(previousCap,hardwareCap):hardwareCap;
  // Rename the supported legacy alias only within the agents table.
  if(settings.cap!==undefined) {
    const lines=config.split(/\r?\n/),visible=visibleLines(lines);let inAgents=false;
    config=lines.map((line,i)=>{if(visible[i]&&/^\s*\[/.test(line))inAgents=tableName(line)==='agents';return inAgents&&visible[i]?line.replace(/^(\s*)(?:max_threads|"max_threads"|'max_threads')(\s*=)/,'$1max_concurrent_threads_per_session$2'):line;}).join('\n');
  }
  config=setToml(config,'agents','enabled','true');
  config=setToml(config,'agents','max_concurrent_threads_per_session',String(cap));
  config=setToml(config,'agents','max_depth','1');
  config=setToml(config,'agents','interrupt_message','true');
  config=setToml(config,'features','hooks','true');
  if(settings.legacyMulti===false) config=setToml(config,'features','multi_agent','true');
  parsedSettings(before,config);
  files.set('config.toml',Buffer.from(config));
  const override=original('AGENTS.override.md');
  if(override?.toString('utf8').trim()) throw new Error('Global AGENTS.override.md shadows AGENTS.md; review it before installation');
  let guidance=original('AGENTS.md')?.toString('utf8')??'';
  const begin='<!-- codex-autonomy:begin -->',end='<!-- codex-autonomy:end -->';
  if(guidance.includes(begin)!==guidance.includes(end)) throw new Error('Malformed owned guidance block');
  const addition=read('templates/AGENTS.md').toString('utf8').trim();
  if(guidance.includes(begin)) guidance=guidance.replace(/<!-- codex-autonomy:begin -->[\s\S]*?<!-- codex-autonomy:end -->/,addition);
  else guidance=guidance+(guidance&&!guidance.endsWith('\n')?'\n':'')+(guidance?'\n':'')+addition+'\n';
  if(Buffer.byteLength(guidance)>8192) throw new Error('Global guidance would exceed compact 8KiB budget');
  files.set('AGENTS.md',Buffer.from(guidance));
  const target=guarded(home,'autonomy/controller.mjs');
  const revision=hash(read('controller.mjs'));
  const command=posixQuote(process.execPath)+' '+posixQuote(target)+' --revision '+revision;
  const winInner='& '+psQuote(process.execPath)+' '+psQuote(target)+' --revision '+revision;
  if(winInner.includes('"')||winInner.includes('$')||winInner.includes('`')) throw new Error('Unsupported shell characters in installation path');
  const commandWindows='powershell.exe -NoProfile -NonInteractive -Command "'+winInner+'"';
  const raw=original('hooks.json');
  const hooks=raw?JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')):{hooks:{}};
  if(!hooks||Array.isArray(hooks)||typeof hooks!=='object'||!hooks.hooks||typeof hooks.hooks!=='object'||Array.isArray(hooks.hooks)) throw new Error('Invalid existing hooks object');
  for(const event of ['SessionStart','SubagentStart','SubagentStop','Stop','Interrupt','UserPromptSubmit']) {
    const groups=hooks.hooks[event]??[];if(!Array.isArray(groups)) throw new Error('Invalid event groups');
    const owned=g=>Array.isArray(g.hooks)&&g.hooks.length===1&&g.hooks[0].statusMessage===`Autonomy: ${event}`&&typeof g.hooks[0].command==='string'&&g.hooks[0].command.includes(posixQuote(target)+' --revision ')&&/ --revision [a-f0-9]{64}$/.test(g.hooks[0].command);
    hooks.hooks[event]=groups.filter(g=>!owned(g));
    const handler={type:'command',command,commandWindows,timeout:event==='Interrupt'?3:10,statusMessage:`Autonomy: ${event}`};
    if(['SessionStart','SubagentStart'].includes(event)) handler.additionalContextLimit=800;
    hooks.hooks[event].push({hooks:[handler]});
  }
  files.set('hooks.json',Buffer.from(JSON.stringify(hooks,null,2)+'\n'));
  for(const name of ['controller.mjs','preflight.mjs','state-contract.md']) files.set('autonomy/'+name,read(name));
  const skill=read('templates/SKILL.md').toString('utf8').replaceAll('{{AUTONOMY_DIR}}',path.join(home,'autonomy').replaceAll('\\','/'));
  files.set('skills/autonomous-development/SKILL.md',Buffer.from(skill));
  for(const role of ['implementer','verifier','diagnostician']) files.set(`agents/autonomy-${role}.toml`,read(`templates/${role}.toml`));
  return {files,cap,revision};
}
export function install(home) {
  home=path.resolve(home);fs.mkdirSync(home,{recursive:true});guarded(home,'');
  const originals=new Map();
  const original=relative=>{if(!originals.has(relative))originals.set(relative,readSmall(guarded(home,relative),1048576));return originals.get(relative);};
  const {files,cap,revision}=installedFiles(home,original);
  // Complete validation and capture every old byte before the first changed user file.
  const records=[];
  for(const [relative,bytes] of files) {
    const before=original(relative);
    records.push({path:relative,existed:before!==null,beforeHash:before===null?null:hash(before),afterHash:hash(bytes),before});
  }
  const stamp=new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(4).toString('hex');
  const backup=guarded(home,'backups/autonomy-'+stamp);fs.mkdirSync(backup,{recursive:true});
  for(const record of records) if(record.before!==null) {const f=path.join(backup,record.path);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,record.before,{flag:'wx',mode:0o600});}
  const manifest={version:1,home,createdAt:new Date().toISOString(),revision,records:records.map(r=>({path:r.path,existed:r.existed,beforeHash:r.beforeHash,afterHash:r.afterHash}))};
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  // Detect edits that happened while the backup was being made.
  for(const [relative,before] of originals) {const current=readSmall(guarded(home,relative),1048576);if((current===null?null:hash(current))!==(before===null?null:hash(before))) throw new Error('Concurrent edit during installation; no user files changed');}
  const written=[];
  try {
    for(const r of records) {
      if(r.beforeHash===r.afterHash) continue;
      const dest=guarded(home,r.path);fs.mkdirSync(path.dirname(dest),{recursive:true});
      // Never replace config from a stale snapshot after another process updated it.
      const now=readSmall(dest,1048576);if((now===null?null:hash(now))!==r.beforeHash) throw new Error('Concurrent edit during installation');
      const temp=dest+'.autonomy-'+crypto.randomBytes(4).toString('hex');fs.writeFileSync(temp,files.get(r.path),{flag:'wx',mode:0o600});fs.renameSync(temp,dest);written.push(r);
    }
  } catch(error) {
    for(const r of written.reverse()) {
      const dest=guarded(home,r.path);const current=readSmall(dest,1048576);
      if(current!==null&&hash(current)===r.afterHash) {if(r.before===null) fs.unlinkSync(dest);else fs.writeFileSync(dest,r.before);}
    }
    throw error;
  }
  return {home,backup,changed:written.map(r=>r.path),maxConcurrentChildren:cap,controllerRevision:revision,hookTrust:written.some(r=>r.path==='hooks.json')?'review-required':'unchanged-review-state'};
}
export function restore(home,backup) {
  home=path.resolve(home);backup=path.resolve(backup);
  const relative=path.relative(path.join(home,'backups'),backup);
  if(relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('Backup must be inside this CODEX_HOME/backups');
  const m=JSON.parse(readSmall(path.join(backup,'manifest.json'))?.toString('utf8')??'null');
  if(m?.version!==1||m.home!==home||!Array.isArray(m.records)) throw new Error('Invalid restore manifest');
  for(const r of m.records) {
    const target=guarded(home,r.path);const current=readSmall(target,1048576);
    if((current===null?null:hash(current))!==r.afterHash) throw new Error('Concurrent edits: review diff before restore');
    if(r.existed) {const saved=readSmall(guarded(backup,r.path),1048576);if(saved===null||hash(saved)!==r.beforeHash) throw new Error('Backup hash mismatch');}
  }
  const restored=[];
  try {
    for(const r of [...m.records].reverse()) {
      const target=guarded(home,r.path),current=readSmall(target,1048576);
      if((current===null?null:hash(current))!==r.afterHash) throw new Error('Concurrent edit during restoration');
      if(r.existed) fs.writeFileSync(target,fs.readFileSync(path.join(backup,r.path)));else fs.unlinkSync(target);
      restored.push({record:r,installed:current});
    }
  } catch(error) {
    for(const {record:r,installed} of restored.reverse()) {
      const target=guarded(home,r.path),current=readSmall(target,1048576);
      if((current===null?null:hash(current))===r.beforeHash) fs.writeFileSync(target,installed);
    }
    throw error;
  }
  return {restored:true,backup};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
    const home=args.includes('--home')?value('--home'):(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
    let result;
    if(args.includes('restore')) {if(!args.includes('--backup')) throw new Error('--backup required');result=restore(home,value('--backup'));}
    else if(args.includes('install')) result=install(home);
    else throw new Error('Use install or restore [--home PATH] [--backup PATH]');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  } catch(e) {process.stderr.write(e.message+'\n');process.exitCode=1;}
}
