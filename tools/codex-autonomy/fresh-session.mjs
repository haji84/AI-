// A bounded launcher for acceptance evidence, not a development scheduler.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
for(const k of ['--cli','--cwd','--prompt','--output']) if(!args.includes(k)) throw new Error(`${k} required`);
const cli=value('--cli'),cwd=path.resolve(value('--cwd')),output=path.resolve(value('--output'));
const prompt=fs.readFileSync(value('--prompt'),'utf8');
fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(output,{recursive:true});
const prefix=args.includes('--desktop')?['--no-daemon']:[];
const options=[...prefix,'exec','--json','--color','never','--skip-git-repo-check','-C',cwd];
// Restrict this safe fixture to local tools. No ignore-config, auth changes, bypass or API keys.
for(const setting of ['features.apps=false','features.plugins=false','mcp_servers.compass.enabled=false','mcp_servers.addness.enabled=false','mcp_servers.chatcut.enabled=false','mcp_servers.node_repl.enabled=false']) options.push('-c',setting);
options.push('-');
const startedAt=new Date().toISOString();
const stdout=fs.createWriteStream(path.join(output,'events.jsonl'),{flags:'wx'}),stderr=fs.createWriteStream(path.join(output,'stderr.log'),{flags:'wx'});
const observed=fs.createWriteStream(path.join(output,'observed.jsonl'),{flags:'wx'});let pending='';
const child=spawn(cli,options,{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
child.stdout.on('data',chunk=>{pending+=chunk.toString('utf8');let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{observed.write(JSON.stringify({observedAt:new Date().toISOString(),event:JSON.parse(line)})+'\n');}catch{}}});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);child.stdin.end(prompt);
let deadline=false;
const timer=setTimeout(()=>{deadline=true;child.kill('SIGTERM');},Number(args.includes('--timeout-ms')?value('--timeout-ms'):300000));
child.on('error',error=>{fs.writeFileSync(path.join(output,'launch-error.txt'),error.message);});
child.on('close',(code,signal)=>{clearTimeout(timer);observed.end();const receipt={startedAt,endedAt:new Date().toISOString(),code,signal,deadline,cwd,cli,configOverrides:options.filter((x,i)=>options[i-1]==='-c')};fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');process.stdout.write(JSON.stringify(receipt)+'\n');process.exitCode=code===0&&!deadline?0:1;});
