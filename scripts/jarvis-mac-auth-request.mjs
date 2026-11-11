import { execFileSync, spawn } from 'node:child_process';
import { publicEncrypt, constants } from 'node:crypto';
import fs from 'node:fs';

// One bounded login request, never logout/reset/reauth. No raw CLI output is logged.
export function sealAuthUrl(text, publicKey) {
  const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
  if (!match) return null;
  return publicEncrypt({key:publicKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'},Buffer.from(match[0])).toString('base64');
}

export async function requestMacAuth(publicKey) {
  if (process.platform !== 'darwin') throw Error('Mac only');
  const executable='/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (!fs.existsSync(executable)) throw Error('Installed Tailscale app unavailable');
  const env={...process.env,TAILSCALE_BE_CLI:'1'};
  let state;
  try { state=JSON.parse(execFileSync(executable,['status','--json'],{encoding:'utf8',timeout:10000,env,stdio:['ignore','pipe','pipe']})); }
  catch { return {status:'STATUS_UNAVAILABLE'}; }
  if(state.BackendState==='Running')return {status:'ALREADY_RUNNING'};
  if(state.BackendState!=='NeedsLogin')return {status:'STATE_REQUIRES_DIAGNOSIS'};
  const existing=sealAuthUrl(JSON.stringify(state),publicKey);
  if(existing)return {status:'LOGIN_REQUIRED',ciphertext:existing};
  return new Promise(resolve=>{
    const child=spawn(executable,['up','--json','--timeout=20s'],{env,stdio:['ignore','pipe','pipe']});
    let output='',done=false;
    const end=result=>{if(done)return;done=true;clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');resolve(result);};
    const timer=setTimeout(()=>end({status:'LOGIN_URL_UNAVAILABLE'}),25000);
    const collect=data=>{output+=data.toString();if(output.length>65536)return end({status:'OUTPUT_LIMIT'});const ciphertext=sealAuthUrl(output,publicKey);if(ciphertext)end({status:'LOGIN_REQUIRED',ciphertext});};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',()=>end({status:'CLI_UNAVAILABLE'}));
    child.on('close',()=>end({status:'LOGIN_URL_UNAVAILABLE'}));
  });
}

if(process.argv[2]==='--request'){
  try{
    const key=Buffer.from(process.env.JARVIS_AUTH_TRANSPORT_PUBLIC_KEY??'','base64').toString('utf8');
    // Validate before invoking CLI; reject an absent/invalid key without requesting login.
    publicEncrypt({key,oaepHash:'sha256'},Buffer.from('transport-key-check'));
    console.log('JARVIS_AUTH_REQUEST='+JSON.stringify(await requestMacAuth(key)));
  }catch{console.log('JARVIS_AUTH_REQUEST='+JSON.stringify({status:'REQUEST_FAILED'}));process.exitCode=1;}
}
