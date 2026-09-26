import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validateRequirements} from './validate-jarvis-requirements.mjs';

export const AUDIT_ROOTS = Object.freeze(['src/jarvis','src/gai','src/app/jarvis','src/app/api/jarvis','apps/ios-worker','apps/ios-owner','android/jarvis-worker/app/src/main','docs/architecture','src/orchestrator','src/compass','src/app/api/command','src/app/api/owner-login','src/app/api/owner-logout','src/app/api/vercel-owner']);
const configFiles=['src/app/owner-auth.ts','src/app/owner-login-redirect.ts','src/app/google-owner-oidc.ts','src/app/google-owner-enrollment.ts','src/app/google-owner-service.ts','src/app/google-owner-state-client.ts','android/jarvis-worker/build.gradle.kts','android/jarvis-worker/app/build.gradle.kts','android/jarvis-worker/gradle.properties','android/jarvis-worker/settings.gradle.kts'];
const isTestSource = p => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const safePath = p => typeof p==='string' && !path.isAbsolute(p) && !p.includes('\\') && !p.split('/').some(x=>!x || x==='.' || x==='..');
const nonempty = x => typeof x==='string' && x.trim().length>0;
const uniqueStrings = xs => Array.isArray(xs) && xs.every(nonempty) && new Set(xs).size===xs.length;
const hash = text => createHash('sha256').update(text).digest('hex');
export function surfaceFingerprint(bytes) {
 // Git text checkouts may use CRLF on Windows. Preserve binary bytes; normalize only UTF-8 text line endings.
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.includes(0))return hash(bytes);
 try{return hash(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/\r\n/g,'\n'));}catch{return hash(bytes);}
}
export function enumerateSurfaces(root) {
 const found=[];
 const visit=relative=>{
  const absolute=path.join(root,relative);if(!fs.existsSync(absolute))return;
  const stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())throw Error('symbolic surface requires explicit audit: '+relative);
  if(stat.isDirectory()){for(const f of fs.readdirSync(absolute).sort())visit(relative+'/'+f);return;}
  if(!isTestSource(relative))found.push(relative);
 };
 for(const p of AUDIT_ROOTS)visit(p);
 for(const p of configFiles)visit(p);
 for(const p of fs.readdirSync(path.join(root,'scripts')).filter(p=>p.startsWith('jarvis')&&!isTestSource(p)))visit('scripts/'+p);
 return [...new Set(found)].sort();
}
export function validateReverseTraceability(report,matrix,root) {
 const errors=[];
 if(report?.schema_version!==1 || !Array.isArray(report.surfaces))return ['Invalid reverse traceability envelope'];
 if(report.hash_policy!=='utf8-crlf-to-lf-v1;binary-raw')errors.push('Unknown surface hash policy');
 if(!/^[a-f0-9]{40}$/.test(report.source_main??''))errors.push('Missing exact source main');
 let files;try{files=enumerateSurfaces(root);}catch(e){return [e.message];}
 const paths=new Set(files),seen=new Set(),ids=new Set(matrix.requirements.map(r=>r.id));
 for(const row of report.surfaces){
  if(!safePath(row?.path)){errors.push('unsafe path');continue;}
  if(seen.has(row.path))errors.push('duplicate surface: '+row.path);seen.add(row.path);
  if(!paths.has(row.path)){errors.push('absent surface: '+row.path);continue;}
  const digest=surfaceFingerprint(fs.readFileSync(path.join(root,row.path)));
  if(row.sha256!==digest)errors.push('changed surface needs reconciliation: '+row.path);
  if(!['COVERED_BY_REQUIREMENT','INTERNAL_IMPLEMENTATION_DETAIL','HISTORICAL_DEAD_SUPERSEDED','EXCLUDED','MISSING_CANONICAL_REQUIREMENT'].includes(row.classification))errors.push('unknown classification: '+row.path);
  if(!nonempty(row.reason))errors.push('missing classification reason: '+row.path);
  if(!uniqueStrings(row.requirement_ids))errors.push('invalid parent list: '+row.path);
  else{
   for(const id of row.requirement_ids)if(!ids.has(id))errors.push('unknown parent '+id+': '+row.path);
   if(['COVERED_BY_REQUIREMENT','INTERNAL_IMPLEMENTATION_DETAIL'].includes(row.classification)&&!row.requirement_ids.length)errors.push('missing canonical parent: '+row.path);
  }
  if(['EXCLUDED','HISTORICAL_DEAD_SUPERSEDED'].includes(row.classification)){
   const ref=row.exclusion_ref;
   const linkedIssue=typeof ref==='string'&&/^https:\/\/github\.com\/haji84\/AI-\/(issues|pull)\/\d+$/.test(ref);
   const local=safePath(ref)&&fs.existsSync(path.join(root,ref))&&fs.statSync(path.join(root,ref)).isFile()&&fs.realpathSync(path.join(root,ref)).startsWith(fs.realpathSync(root)+path.sep);
   if(!linkedIssue&&!local)errors.push('invalid exclusion source: '+row.path);
  }
  if(row.classification==='MISSING_CANONICAL_REQUIREMENT')errors.push('unreconciled canonical behavior: '+row.path);
 }
 for(const p of files)if(!seen.has(p))errors.push('unmapped surface: '+p);
 return errors;
}
export function requirementFingerprint(row){return hash(JSON.stringify({id:row.id,title:row.title,description:row.description,required_evidence:row.required_evidence}));}
export function validateOwnerDecisions(envelope,matrix,ledger,root,inventory){
 const errors=validateRequirements(matrix,ledger,root,inventory);
 if(envelope?.schema_version!==1 || !Array.isArray(envelope.decisions))return [...errors,'Invalid owner decision envelope'];
 const rows=new Map(matrix.requirements.map(r=>[r.id,r])),records=new Map();
 const states=['IDEA','PROPOSED','ACCEPTED_REQUIREMENT','SPEC_SYNCED','IMPLEMENTED','VERIFIED','SUPERSEDED','WITHDRAWN'];
 for(const d of envelope.decisions){
  if(!nonempty(d?.id)||records.has(d.id)){errors.push('duplicate or missing decision ID');continue;}records.set(d.id,d);
  if(!states.includes(d.state))errors.push('invalid decision state: '+d.id);
  if(!Array.isArray(d.protected_changes))errors.push('invalid protected change list: '+d.id);
  if(d.protected_changes?.length)errors.push('protected change needs separate Human Gate; this sync contract cannot authorize it: '+d.id);
  if(!['IDEA','PROPOSED'].includes(d.state)){
   if(d.source?.kind!=='owner_instruction'||d.source?.decision!=='accepted'||d.source?.author!=='haji84'||!/^https:\/\/github\.com\/haji84\/AI-\/(issues|pull)\/\d+(?:#[-\w]+)?$/.test(d.source?.ref??'')||!/^[a-f0-9]{64}$/.test(d.source?.text_sha256??'')||!Number.isFinite(Date.parse(d.source?.recorded_at)))errors.push('explicit owner acceptance provenance required: '+d.id);
  }
  if(d.source?.excerpt!==undefined && (!nonempty(d.source.excerpt)||d.source.text_sha256!==hash(d.source.excerpt)))errors.push('source excerpt hash mismatch: '+d.id);
  if(d.state==='ACCEPTED_REQUIREMENT')errors.push('unsynced accepted owner requirement: '+d.id);
  if(['SPEC_SYNCED','IMPLEMENTED','VERIFIED'].includes(d.state)){
   if(!Array.isArray(d.canonical)||!d.canonical.length){errors.push('missing canonical binding: '+d.id);continue;}
  }
  if(!Array.isArray(d.canonical))errors.push('invalid canonical bindings: '+d.id);
  else {
   for(const link of d.canonical){
    const row=rows.get(link.id);if(!row){errors.push('unknown canonical binding: '+d.id);continue;}
    if(link.fingerprint!==requirementFingerprint(row)||!row.source_decisions?.includes(d.id))errors.push('stale or unlinked canonical binding: '+d.id);
    if(d.state==='IMPLEMENTED'&&!['IMPLEMENTED_UNVERIFIED','VERIFIED','PLATFORM_LIMITED'].includes(row.status))errors.push('unimplemented canonical requirement: '+d.id);
    if(d.state==='VERIFIED'&&row.status!=='VERIFIED')errors.push('unverified canonical requirement: '+d.id);
   }
  }
  if(!uniqueStrings(d.supersedes)||!uniqueStrings(d.superseded_by))errors.push('invalid supersede history: '+d.id);
 }
 for(const d of records.values()){
  for(const old of d.supersedes??[])if(!records.get(old)?.superseded_by?.includes(d.id))errors.push('missing reciprocal supersede history: '+d.id);
  for(const next of d.superseded_by??[])if(!records.get(next)?.supersedes?.includes(d.id))errors.push('missing reciprocal supersede history: '+d.id);
  if(d.state==='SUPERSEDED'&&!d.superseded_by?.length)errors.push('missing supersede successor: '+d.id);
  if(d.superseded_by?.length&&d.state!=='SUPERSEDED')errors.push('superseded decision still active: '+d.id);
 }
 for(const row of matrix.requirements){
  if(row.source_decisions!==undefined&&!uniqueStrings(row.source_decisions)){errors.push('invalid canonical decision links: '+row.id);continue;}
  for(const id of row.source_decisions??[]){const d=records.get(id);if(!d){errors.push('missing source decision history: '+id);continue;}
   if(['IDEA','PROPOSED'].includes(d.state)||!d.canonical?.some(link=>link.id===row.id))errors.push('canonical link lacks adopted decision: '+id);
  }
 }
 for(const allocation of inventory?.allocations??[]){const d=records.get(allocation.decision_id);if(!d?.canonical?.some(link=>link.id===allocation.id))errors.push('allocation provenance lost: '+allocation.id);}
 const active=new Set(),done=new Set();
 const visit=id=>{if(active.has(id)){errors.push('supersede cycle: '+id);return;}if(done.has(id))return;active.add(id);for(const n of records.get(id)?.superseded_by??[])if(records.has(n))visit(n);active.delete(id);done.add(id);};
 for(const id of records.keys())visit(id);
 return errors;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 try{
  if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('Only --check is supported; no automatic re-baseline or production mutation');
  const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const matrix=read('docs/jarvis-requirements.json'),report=read('docs/jarvis-reverse-traceability.json');
  const errors=[...validateReverseTraceability(report,matrix,root),...validateOwnerDecisions(read('docs/jarvis-owner-decisions.json'),matrix,fs.readFileSync(path.join(root,'docs/JARVIS_PRODUCT_SPEC.md'),'utf8'),root)];
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(JSON.stringify({status:'PASS',surfaces:report.surfaces.length,requirements:matrix.requirements.length,functional_completion_claim:false}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
