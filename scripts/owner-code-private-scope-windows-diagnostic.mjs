// Temporary owned-public fixture diagnosis. This never establishes source acceptance.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source='scripts/owner-code-private-scope-capture.test.mjs';
const expected='0e08e7b0653b95dcf1a7f976439657bd041aa1e0d55ac74a9c85101a7201a479';
const marker='OWNED_PUBLIC_SCOPE_DIAGNOSTIC ';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const replaceOnce=(text,from,to)=>{
  if(text.split(from).length!==2)throw new Error('DERIVATION_REFUSED');
  return text.replace(from,to);
};
const shape={exceptionKind:['NONE','OTHER','System.Management.Automation.RuntimeException','System.Management.Automation.MethodInvocationException','System.Management.Automation.ParameterBindingException','System.InvalidOperationException','System.ArgumentException'],innerKind:['NONE','OTHER','System.InvalidOperationException','System.ArgumentException','System.NotSupportedException','System.PlatformNotSupportedException'],role:['NONE','OTHER_PUBLIC_CODE','NATIVE_ENTRY_SOURCE','IMMUTABLE_TRANSACTION_SOURCE','OWNED_PUBLIC_FIXTURE']};
const counts=['line','configurationReads','taskReads'];
const booleans=['rejected','bound'];
function closed(value){
  const names=[...Object.keys(shape),...counts,...booleans];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||names.some(k=>!Object.hasOwn(value,k)))throw new Error('DIAGNOSTIC_PROTOCOL_REFUSED');
  if(Object.entries(shape).some(([k,allowed])=>!allowed.includes(value[k]))||counts.some(k=>!Number.isSafeInteger(value[k])||value[k]<0||value[k]>1000000)||booleans.some(k=>typeof value[k]!=='boolean'))throw new Error('DIAGNOSTIC_PROTOCOL_REFUSED');
  return value;
}
function derive(text){
  text=replaceOnce(text,'catch{$rejected=$true};@{missingFeature=',`catch{
$rejected=$true;$diagKind=$_.Exception.GetType().FullName;$diagInner='NONE';$diagRole='OTHER_PUBLIC_CODE';$diagLine=0
if($diagKind -cnotin @('System.Management.Automation.RuntimeException','System.Management.Automation.MethodInvocationException','System.Management.Automation.ParameterBindingException','System.InvalidOperationException','System.ArgumentException')){$diagKind='OTHER'}
if($_.Exception.InnerException){$diagInner=$_.Exception.InnerException.GetType().FullName;if($diagInner -cnotin @('System.InvalidOperationException','System.ArgumentException','System.NotSupportedException','System.PlatformNotSupportedException')){$diagInner='OTHER'}}
if($_.InvocationInfo){$publicRole=[IO.Path]::GetFileName([string]$_.InvocationInfo.ScriptName);$diagLine=[int]$_.InvocationInfo.ScriptLineNumber
$diagRole=switch -CaseSensitive ($publicRole){'owner-code-rotation-native-1218.ps1'{'NATIVE_ENTRY_SOURCE'};'rotate-jarvis-owner-code-windows.ps1'{'IMMUTABLE_TRANSACTION_SOURCE'};'fixture.ps1'{'OWNED_PUBLIC_FIXTURE'};default{'OTHER_PUBLIC_CODE'}}}
};@{missingFeature=`);
  text=replaceOnce(text,'configurationReads=$script:reads}|ConvertTo-Json -Compress',`configurationReads=$script:reads;diagnostic=@{exceptionKind=$(if($diagKind){$diagKind}else{'NONE'});innerKind=$(if($diagInner){$diagInner}else{'NONE'});role=$(if($diagRole){$diagRole}else{'NONE'});line=[int]$diagLine;configurationReads=$script:reads;taskReads=$script:calls;rejected=[bool]$rejected;bound=[bool]$bound}}|ConvertTo-Json -Depth 3 -Compress`);
  return replaceOnce(text,"const r=capture('success');assert.equal",`const r=capture('success');process.stdout.write(${JSON.stringify(marker)}+JSON.stringify(r.diagnostic)+'\\n');assert.equal`);
}

const answer={label:'DIAGNOSTIC_NOT_SOURCE_ACCEPTANCE',sourceAcceptance:false,diagnosticComplete:false,status:'INERT',targetWindows:false,sourceSha256:expected,derivedSha256:null,childExit:null,stdoutBytes:0,stderrBytes:0,diagnostic:null,ownedFixtureCleaned:false};
let owned,evidence;
try{
  if(process.argv.length!==3||process.argv[2]!=='--run')throw new Error('INERT');
  if(resolve(process.cwd())!==root)throw new Error('CONTEXT_REFUSED');
  const bytes=readFileSync(join(root,source));
  if(sha(bytes)!==expected)throw new Error('TEST_SOURCE_REFUSED');
  const derived=derive(bytes.toString('utf8'));answer.derivedSha256=sha(derived);answer.targetWindows=process.platform==='win32';
  const parent=join(root,'.gai-results');
  if(existsSync(parent)){const st=lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('EVIDENCE_REFUSED');}else mkdirSync(parent,{mode:0o700});
  evidence=join(parent,'owned-public-scope-windows-diagnostic');mkdirSync(evidence,{mode:0o700});
  owned=mkdtempSync(join(tmpdir(),'owned-public-scope-diagnostic-'));const script=join(owned,'capture.test.mjs');writeFileSync(script,derived,{flag:'wx',mode:0o600});
  writeFileSync(join(evidence,'derived-public-fixture.test.mjs'),derived,{flag:'wx',mode:0o600});
  const env=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','PATHEXT','COMSPEC','USERPROFILE','LOCALAPPDATA','TEMP','TMP','TMPDIR'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
  const run=spawnSync(process.execPath,['--test','--test-reporter=spec','--test-name-pattern=^host-local scope derives private metadata from fixed configuration and current task without emitting it$',script],{cwd:root,env,encoding:'utf8',timeout:30000,maxBuffer:32768});
  const stdout=Buffer.from(run.stdout??''),stderr=Buffer.from(run.stderr??'');answer.stdoutBytes=stdout.length;answer.stderrBytes=stderr.length;answer.childExit=Number.isInteger(run.status)?run.status:null;
  writeFileSync(join(evidence,'child-stdout-bounded.log'),stdout.subarray(0,32768),{flag:'wx',mode:0o600});writeFileSync(join(evidence,'child-stderr-bounded.log'),stderr.subarray(0,32768),{flag:'wx',mode:0o600});
  if(run.error)throw new Error(run.error.code==='ENOBUFS'?'BUFFER_REFUSED':'CHILD_REFUSED');
  const lines=stdout.toString('utf8').split(/\r?\n/).filter(line=>line.startsWith(marker));
  if(lines.length!==1)throw new Error('DIAGNOSTIC_PROTOCOL_REFUSED');
  answer.diagnostic=closed(JSON.parse(lines[0].slice(marker.length)));answer.diagnosticComplete=true;answer.status='MEASURED';
}catch(error){answer.status=['INERT','CONTEXT_REFUSED','TEST_SOURCE_REFUSED','DERIVATION_REFUSED','DIAGNOSTIC_PROTOCOL_REFUSED','EVIDENCE_REFUSED','BUFFER_REFUSED','CHILD_REFUSED'].includes(error.message)?error.message:'HELPER_REFUSED';}
finally{if(owned){try{rmSync(owned,{recursive:true,force:true});answer.ownedFixtureCleaned=true;}catch{answer.status='OWNED_CLEANUP_REFUSED';answer.diagnosticComplete=false;}}if(evidence){try{writeFileSync(join(evidence,'safe-result.json'),JSON.stringify(answer,null,2)+'\n',{flag:'wx',mode:0o600});}catch{answer.status='EVIDENCE_REFUSED';answer.diagnosticComplete=false;}}}
// Child failure is evidence. Always let the unchanged acceptance suite run next.
console.log(JSON.stringify(answer));
