import {createHash} from 'node:crypto';
import {loadCanonicalBundle,prepareSpecificationProposal,CANONICAL_PATHS} from './jarvis-owner-spec-sync.mjs';
import {surfaceFingerprint} from './jarvis-requirement-audit.mjs';
import {auditText} from './jarvis-secret-audit.mjs';

const API='https://api.github.com/repos/haji84/AI-';
const PATHS=CANONICAL_PATHS;
const MAX_BYTES=2*1024*1024;
const hash=v=>createHash('sha256').update(v).digest('hex');
const sha=v=>{if(typeof v!=='string'||!/^[a-f0-9]{40}$/.test(v))throw Error('github_invalid_sha');return v;};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function reviewInput(review){
 if(!plain(review)||Object.keys(review).some(k=>!['sourceRef','bindings','newRequirement'].includes(k))||Buffer.byteLength(JSON.stringify(review))>32768||
 !/^https:\/\/github\.com\/haji84\/AI-\/issues\/[1-9][0-9]*$/.test(review.sourceRef??'')||
 !Array.isArray(review.bindings)||review.bindings.length>8||
 review.bindings.some(b=>!plain(b)||Object.keys(b).some(k=>!['id','baseFingerprint'].includes(k))||!/^[-A-Z]+-\d{3}$/.test(b.id??'')||!(/^[a-f0-9]{64}$/).test(b.baseFingerprint??'')))throw Error('invalid_specification_review');
 return globalThis.structuredClone(review);
}
// Generated edits only; compare line multiplicities so JSON pretty-printing cannot
// consume an unbounded patch. This is not the generic arbitrary-file PR capability.
function changedBytes(before,after){
 const counts=new Map();
 for(const line of before.replaceAll('\r\n','\n').split('\n'))counts.set(line,(counts.get(line)??0)+1);
 for(const line of after.replaceAll('\r\n','\n').split('\n'))counts.set(line,(counts.get(line)??0)-1);
 return [...counts].reduce((sum,[line,n])=>sum+Math.abs(n)*(Buffer.byteLength(line)+1),0);
}
function bounded(promise,signal){
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('github_transport_failure'));
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
export function createSpecificationPublisher({root,intake,token,fetchImpl=fetch,timeoutMs=45000}){
 const running=new Set();
 return {async publish(decisionId,rawReview){
  if(!/^owner-intake-[a-f0-9]{32}$/.test(decisionId??''))throw Error('invalid_decision_id');
  const review=reviewInput(rawReview);
  if(typeof token!=='string'||!token.trim())throw Error('github_write_unavailable');
  if(running.has(decisionId))throw Error('publication_in_progress');
  running.add(decisionId);
  const controller=new globalThis.AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(45000,Math.max(1,timeoutMs)));
  let requests=0;
  const current=()=>{const r=intake.list().find(r=>r.id===decisionId);if(!r||r.state!=='ACCEPTED_REQUIREMENT')throw Error('receipt_changed');return r;};
  async function request(route,{method='GET',body,missing=false}={}){
   if(++requests>24)throw Error('github_request_limit');
   if(controller.signal.aborted)throw Error('github_transport_failure');
   // Every route is constructed internally; callers cannot choose host or credentials.
   const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
   let response;
   try{response=await bounded(fetchImpl(API+route,{method,redirect:'error',signal,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),signal);}
   catch{throw Error('github_transport_failure');}
   if(response.status===404&&missing){await response.body?.cancel();return null;}
   if(!response.ok){await response.body?.cancel();throw Error('github_status_'+response.status);}
   if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw Error('github_response_limit');}
   const reader=response.body?.getReader();if(!reader)throw Error('github_invalid_response');
   let size=0;const chunks=[];
   try{while(true){const {done,value}=await bounded(reader.read(),signal);if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('github_response_limit');}chunks.push(Buffer.from(value));}}
   catch(e){void reader.cancel().catch(()=>{});if(e.message==='github_response_limit')throw e;throw Error('github_transport_failure');}
   try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('github_invalid_response');}
  }
  try{
   const record=current(),history=intake.list(),bundle=loadCanonicalBundle(root);
   if(auditText(record.statement,{path:"owner-requirement",source:false}).length)throw Error("specification_secret_detected");
   const proposal=prepareSpecificationProposal(record,bundle,review,root,history);
   const originals=[bundle.ledger,JSON.stringify(bundle.matrix,null,2)+'\n',JSON.stringify(bundle.decisions,null,2)+'\n',JSON.stringify(bundle.inventory,null,2)+'\n'];
   if(proposal.files.length!==4||proposal.files.some((f,i)=>f.path!==PATHS[i])||
    proposal.files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)>MAX_BYTES||
    proposal.files.reduce((n,f,i)=>n+changedBytes(originals[i],f.content),0)>100000)throw Error('specification_output_limit');
   if(proposal.files.some(f=>auditText(f.content,{path:f.path,source:false}).length))throw Error('specification_secret_detected');
   const artifactHash=hash(JSON.stringify(proposal.files));
   const reviewHash=hash(JSON.stringify(review));
   const source=await request('/issues/'+review.sourceRef.split('/').at(-1));
   if((source?.state!=='open'&&!record.publication)||source?.pull_request||source?.user?.login!=='haji84')throw Error('owner_source_issue_unavailable');
   const mainSha=sha((await request('/git/ref/heads/main'))?.object?.sha);
   // Resume the immutable original commit while still checking current main content.
   const baseSha=record.publication?.baseSha??mainSha;
   const baseTree=sha((await request('/git/commits/'+baseSha))?.tree?.sha);
   for(const file of proposal.files){
    const remote=await request('/contents/'+file.path+'?ref='+mainSha);
    if(remote?.type!=='file'||remote.encoding!=='base64'||typeof remote.content!=='string'||
     surfaceFingerprint(Buffer.from(remote.content,'base64'))!==file.baseSha256)throw Error('canonical_base_conflict');
   }
   const branch='codex/spec-sync/'+decisionId;
   let journal={baseSha,artifactHash,reviewHash,branch};
   intake.recordPublication(decisionId,journal);
   const guard=()=>{
    const now=current();
    if(now.requestHash!==record.requestHash||now.goalId!==record.goalId)throw Error('receipt_changed');
    const fresh=prepareSpecificationProposal(now,loadCanonicalBundle(root),review,root,intake.list());
    if(hash(JSON.stringify(fresh.files))!==artifactHash)throw Error('canonical_base_conflict');
   };
   guard();
   const tree=sha((await request('/git/trees',{method:'POST',body:{base_tree:baseTree,tree:proposal.files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.content}))}}))?.sha);
   guard();
   const actor={name:'JARVIS Specification Publisher',email:'jarvis-spec@users.noreply.github.com',date:new Date(record.source.recordedAt).toISOString()};
   const commit=sha((await request('/git/commits',{method:'POST',body:{message:'docs: propose owner specification '+decisionId,tree,parents:[baseSha],author:actor,committer:actor}}))?.sha);
   journal={...journal,headSha:commit};intake.recordPublication(decisionId,journal);
   const existing=await request('/git/ref/heads/'+branch,{missing:true});
   if(existing&&sha(existing.object?.sha)!==commit)throw Error('publication_branch_conflict');
   if(!existing){
    guard();
    const ref=await request('/git/refs',{method:'POST',body:{ref:'refs/heads/'+branch,sha:commit}});
    if(ref?.ref!=='refs/heads/'+branch||sha(ref.object?.sha)!==commit)throw Error('publication_branch_conflict');
   }
   const pulls=await request('/pulls?state=all&head='+encodeURIComponent('haji84:'+branch)+'&base=main&per_page=10');
   if(!Array.isArray(pulls)||pulls.length>1)throw Error('publication_pr_conflict');
   guard();
   let pr=pulls[0];
   if(!pr)pr=await request('/pulls',{method:'POST',body:{title:'docs: review adopted owner requirement '+decisionId,head:branch,base:'main',draft:true,
    body:'Saved authenticated owner requirement: '+decisionId+'\n\nSource: '+review.sourceRef+'\n\nOnly the three generated canonical specification files are proposed. Semantic conflict, Human Gate scope, CI and independent review remain required. This Draft PR does not authorize implementation, merge or deployment. Publication is not canonical synchronization.\n\nArtifact SHA-256: '+artifactHash}});
   if(!Number.isSafeInteger(pr?.number)||pr.number<1||pr.html_url!=='https://github.com/haji84/AI-/pull/'+pr.number||
    pr.state!=='open'||pr.draft!==true||pr.head?.sha!==commit||pr.head?.ref!==branch||pr.head?.repo?.full_name!=='haji84/AI-'||
    pr.base?.ref!=='main'||pr.base?.repo?.full_name!=='haji84/AI-')throw Error('publication_pr_conflict');
   guard();
   journal={...journal,prNumber:pr.number};intake.recordPublication(decisionId,journal);
   return {status:'DRAFT_OPEN',url:pr.html_url,number:pr.number,headSha:commit,branch,canonicalSynced:false};
  }finally{clearTimeout(timer);running.delete(decisionId);}
 }};
}
