import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {install,restore} from './install.mjs';

const script = fileURLToPath(new URL('./install.mjs', import.meta.url));
const pythonExecutable=['python3','python'].find(binary=>spawnSync(binary,['-c','import tomllib'],{stdio:'ignore',windowsHide:true}).status===0);
assert.ok(pythonExecutable,'Python 3.11+ is required for independent TOML checks');
function fixture(t) {
  const tempRoot=fs.realpathSync(os.tmpdir());
  const base = fs.mkdtempSync(path.join(tempRoot, 'codex-autonomy-install-'));
  t.after(() => { assert.ok(path.resolve(base).startsWith(path.join(tempRoot,'codex-autonomy-install-'))); fs.rmSync(base,{recursive:true,force:true}); });
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const config = 'model = "keep-model"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n[features]\njs_repl = false\n[projects."sample"]\ntrust_level = "untrusted"\n[mcp_servers.existing]\ncommand = "keep-command"\n';
  fs.writeFileSync(path.join(home,'config.toml'),config);
  fs.writeFileSync(path.join(home,'AGENTS.md'),'# Existing owner rules\nKeep owner gates.\n');
  fs.writeFileSync(path.join(home,'hooks.json'), JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo existing'}]}]}}));
  return {home,config};
}
function run(home, ...args) {
  return spawnSync(process.execPath,[script,'--home',home,...args],{encoding:'utf8'});
}

test('install preserves existing permissions, model, project trust, guidance and hooks', t => {
  const {home,config} = fixture(t); const result = run(home,'install');
  assert.equal(result.status,0,result.stderr);
  const after=fs.readFileSync(path.join(home,'config.toml'),'utf8');
  for(const line of config.trim().split('\n')) assert.ok(after.includes(line),line);
  const guidance=fs.readFileSync(path.join(home,'AGENTS.md'),'utf8');
  assert.ok(guidance.startsWith('# Existing owner rules\nKeep owner gates.\n'));
  const hooks=JSON.parse(fs.readFileSync(path.join(home,'hooks.json'))).hooks;
  assert.equal(hooks.Stop[0].hooks[0].command,'echo existing');
  assert.equal(hooks.Stop.length,2);
  for (const event of ['SessionStart','SubagentStart','SubagentStop','Stop','Interrupt','UserPromptSubmit']) assert.ok(hooks[event]?.length);
  assert.ok(!after.includes('dangerously-bypass'));
  const receipt=JSON.parse(result.stdout);
  assert.ok(fs.existsSync(path.join(receipt.backup,'config.toml')));
  assert.equal(fs.readFileSync(path.join(receipt.backup,'config.toml'),'utf8'),config);
  assert.equal(receipt.hookTrust,'review-required');
});

test('repeated install does not duplicate guidance or hook handlers',t=>{
  const {home}=fixture(t); assert.equal(run(home,'install').status,0);
  const a=fs.readFileSync(path.join(home,'AGENTS.md'),'utf8');
  const b=fs.readFileSync(path.join(home,'hooks.json'),'utf8');
  const second=run(home,'install'); assert.equal(second.status,0,second.stderr);
  assert.equal(JSON.parse(second.stdout).hookTrust,'unchanged-review-state');
  assert.equal(fs.readFileSync(path.join(home,'AGENTS.md'),'utf8'),a);
  assert.equal(fs.readFileSync(path.join(home,'hooks.json'),'utf8'),b);
});

test('rollback restores exact old bytes and removes only newly installed owned files',t=>{
  const {home,config}=fixture(t); const installed=run(home,'install'); assert.equal(installed.status,0,installed.stderr);
  const receipt=JSON.parse(installed.stdout); fs.writeFileSync(path.join(home,'unrelated.txt'),'retain');
  const result=run(home,'restore','--backup',receipt.backup); assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(home,'config.toml'),'utf8'),config);
  assert.equal(fs.readFileSync(path.join(home,'AGENTS.md'),'utf8'),'# Existing owner rules\nKeep owner gates.\n');
  assert.equal(fs.readFileSync(path.join(home,'unrelated.txt'),'utf8'),'retain');
  assert.equal(fs.existsSync(path.join(home,'autonomy','controller.mjs')),false);
});

test('rollback refuses concurrent edits before restoring anything',t=>{
  const {home}=fixture(t); const installed=run(home,'install'); assert.equal(installed.status,0,installed.stderr);
  const receipt=JSON.parse(installed.stdout); const p=path.join(home,'AGENTS.md'); fs.appendFileSync(p,'\nNew owner rule.\n');
  const result=run(home,'restore','--backup',receipt.backup); assert.notEqual(result.status,0);
  assert.ok(fs.readFileSync(p,'utf8').endsWith('New owner rule.\n'));
  assert.ok(fs.existsSync(path.join(home,'autonomy','controller.mjs')));
});

test('global override and malformed hook source refuse installation without changing config',t=>{
  for (const mode of ['override','malformed']) {
    const {home,config}=fixture(t);
    fs.writeFileSync(path.join(home,mode==='override'?'AGENTS.override.md':'hooks.json'),mode==='override'?'Override owner guidance':'{broken');
    const result=run(home,'install'); assert.notEqual(result.status,0);
    assert.equal(fs.readFileSync(path.join(home,'config.toml'),'utf8'),config);
  }
});

test('a safety edit during initial planning is preserved and aborts installation',t=>{
  const {home,config}=fixture(t),file=path.join(home,'config.toml'),read=fs.readFileSync;
  let injected=false;
  fs.readFileSync=function(p,...args){const bytes=read.call(this,p,...args);if(p===file&&!injected){injected=true;fs.writeFileSync(file,config.replace('"never"','"on-request"'));}return bytes;};
  try {assert.throws(()=>install(home),/concurrent/i);} finally {fs.readFileSync=read;}
  assert.ok(read(file,'utf8').includes('approval_policy = "on-request"'));
});

test('commented TOML tables are updated without duplication',t=>{
  const {home,config}=fixture(t);fs.writeFileSync(path.join(home,'config.toml'),config.replace('[features]','[features] # owner settings')+'\n[agents] # child limit\nmax_concurrent_threads_per_session = 1\n');
  const r=run(home,'install');assert.equal(r.status,0,r.stderr);
  const check=spawnSync(pythonExecutable,['-c','import tomllib,sys;d=tomllib.load(open(sys.argv[1],"rb"));assert d["agents"]["max_concurrent_threads_per_session"]==1',path.join(home,'config.toml')],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});

test('cap examples in multiline instructions do not increase the actual cap',t=>{
  const {home}=fixture(t);fs.writeFileSync(path.join(home,'config.toml'),'developer_instructions = """\nExample:\nmax_threads = 6\n[features]\nhooks = false\n"""\n[agents]\nmax_concurrent_threads_per_session = 1\n');
  const r=run(home,'install');assert.equal(r.status,0,r.stderr);
  const check=spawnSync(pythonExecutable,['-c','import tomllib,sys;d=tomllib.load(open(sys.argv[1],"rb"));assert d["agents"]["max_concurrent_threads_per_session"]==1;assert "hooks = false" in d["developer_instructions"];assert d["features"]["hooks"] is True',path.join(home,'config.toml')],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
});

test('unrelated hook with a colliding status label survives installation',t=>{
  const {home}=fixture(t);fs.writeFileSync(path.join(home,'hooks.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo owner-handler',statusMessage:'Autonomy: Stop'}]}]}}));
  const r=run(home,'install');assert.equal(r.status,0,r.stderr);
  const groups=JSON.parse(fs.readFileSync(path.join(home,'hooks.json'))).hooks.Stop;
  assert.ok(groups.some(g=>g.hooks[0].command==='echo owner-handler'));
});

test('restore detects edits during restoration and unwinds its own earlier changes',t=>{
  const {home}=fixture(t),receipt=install(home),file=path.join(home,'config.toml'),unlink=fs.unlinkSync;
  const installed=fs.readFileSync(file,'utf8');let injected=false;
  fs.unlinkSync=function(p,...args){if(p===path.join(home,'agents','autonomy-diagnostician.toml')&&!injected){injected=true;fs.writeFileSync(file,installed.replace('"never"','"on-request"'));}return unlink.call(this,p,...args);};
  try {assert.throws(()=>restore(home,receipt.backup),/concurrent/i);} finally {fs.unlinkSync=unlink;}
  assert.ok(fs.readFileSync(file,'utf8').includes('approval_policy = "on-request"'));
  assert.ok(fs.existsSync(path.join(home,'agents','autonomy-diagnostician.toml')));
});

test('Japanese and Unicode configuration validates through a legacy Windows console encoding',t=>{
  const {home,config}=fixture(t),file=path.join(home,'config.toml');
  fs.writeFileSync(file,'developer_instructions = "日本語と😀"\n'+config);
  const r=spawnSync(process.execPath,[script,'--home',home,'install'],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'cp932'}});
  assert.equal(r.status,0,r.stderr);assert.ok(fs.readFileSync(file,'utf8').includes('日本語と😀'));
});

test('a normal native hook trust record survives a later install',t=>{
  const {home,config}=fixture(t),file=path.join(home,'config.toml');
  fs.writeFileSync(file,config+'\n[hooks.state."native-handler-id"]\ntrusted_hash = "owner-reviewed-native-hash"\n');
  const r=run(home,'install');assert.equal(r.status,0,r.stderr);
  assert.ok(fs.readFileSync(file,'utf8').includes('trusted_hash = "owner-reviewed-native-hash"'));
});

test('inline hook events still refuse duplicate source installation',t=>{
  const {home,config}=fixture(t),file=path.join(home,'config.toml');
  const inline=config+'\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="echo owner-inline"\n';
  fs.writeFileSync(file,inline);const r=run(home,'install');assert.notEqual(r.status,0);
  assert.equal(fs.readFileSync(file,'utf8'),inline);
});
