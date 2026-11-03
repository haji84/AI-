import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateOwnerDecisions,validateReverseTraceability} from './jarvis-requirement-audit.mjs';

const text=v=>typeof v==='string'&&v.trim().length>0;
const strings=v=>Array.isArray(v)&&v.every(text)&&new Set(v).size===v.length;
const cognitiveStates=new Set(['SPECIFIED','IMPLEMENTED','TESTED','VERIFIED','INTEGRATED','EXPERIMENTAL']);
const hash=v=>createHash('sha256').update(v).digest('hex');
const owners={P0:[681,882,1727],P1:[681,882,1662],P2:[681,882,734,1662],P3:[681,882,1207],P4:[681,882,1192],P5:[681,882],P6:[681,882],P7:[681,882,1219,1216],P8:[681,882],P9:[681,882,1207,1192,1662],P10:[681,882]};
const evidenceLead=(ref,records,root)=>{
  const record=records.find(r=>r.id===ref);
  if(record)return {ref,kind:'EVIDENCE_RECORD',class:record.class,result:record.result,commit:record.commit};
  if(/^https:\/\//.test(ref))return {ref,kind:'EXTERNAL_REFERENCE_NOT_VERIFIED'};
  const full=path.resolve(root,ref);
  const inside=!path.isAbsolute(ref)&&full.startsWith(path.resolve(root)+path.sep);
  return {ref,kind:inside&&fs.existsSync(full)?'REPOSITORY_REFERENCE_NOT_SEMANTICALLY_VERIFIED':'MISSING_REPOSITORY_REFERENCE'};
};

export function buildCompletionAudit({root,revision,matrix,ledger,inventory,decisions,reverse,cognitive}) {
  if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('COMPLETION_AUDIT_REVISION_REJECTED');
  const errors=[...validateOwnerDecisions(decisions,matrix,ledger,root,inventory),
    ...validateReverseTraceability(reverse,matrix,root)];
  if(errors.length)throw Error('COMPLETION_AUDIT_CANONICAL_REJECTED: '+errors.join('; '));
  const expected=Array.from({length:17},(_,i)=>'COG-'+String(i+1).padStart(3,'0'));
  if(cognitive?.schema_version!==1||cognitive.canonical_requirement!=='OWN-001'||
    !Array.isArray(cognitive.components)||cognitive.components.length!==17||
    expected.some(id=>cognitive.components.filter(c=>c.id===id).length!==1)||
    cognitive.components.some(c=>!text(c.title)||!text(c.remaining)||!strings(c.states)||!c.states.length||
      c.states.some(s=>!cognitiveStates.has(s))||
      ['implementation_refs','test_refs','evidence_refs'].some(field=>!strings(c[field]))))
    throw Error('COMPLETION_AUDIT_COGNITIVE_REJECTED');
  const requirements=matrix.requirements.map(r=>{
    const surfaceRefs=reverse.surfaces.filter(s=>s.requirement_ids.includes(r.id)).map(s=>s.path);
    return {id:r.id,title:r.title,phase:r.phase,owner_issues:owners[r.phase],canonical_status:r.status,
      acceptance:r.status==='VERIFIED'?'PASS_AT_CANONICAL_VERIFIED_COMMIT':'BLOCKED',
      verified_commit:r.last_verified_commit,required_evidence:r.required_evidence,
      implementation_refs:r.implementation_refs,test_refs:r.test_refs,current_surface_refs:surfaceRefs,
      evidence_leads:r.evidence_refs.map(ref=>evidenceLead(ref,matrix.evidence_records,root)),
      source_decisions:r.source_decisions??[],blocker:r.blocker,next_action:r.next_action,
      boundary:surfaceRefs.length&&r.status==='MISSING'?'SOURCE_PRESENT_BUT_REQUIREMENT_UNVERIFIED':'CANONICAL_STATUS_RETAINED'};
  });
  const counts={};const families={};
  for(const r of requirements){
    counts[r.canonical_status]=(counts[r.canonical_status]??0)+1;
    const family=r.id.replace(/-\d+$/,'');
    families[family]??={total:0,incomplete:0,physical_required:0};
    families[family].total++;families[family].incomplete+=r.canonical_status==='VERIFIED'?0:1;
    families[family].physical_required+=r.required_evidence.includes('PHYSICAL')?1:0;
  }
  return {schema_version:1,issue:1727,parent_issues:[681,1219,882],source_revision:revision,
    sources:{spec:'docs/JARVIS_PRODUCT_SPEC.md',matrix:'docs/jarvis-requirements.json',
      decisions:'docs/jarvis-owner-decisions.json',reverse:'docs/jarvis-reverse-traceability.json',
      cognitive:'docs/goriq-cognitive-status.json',inventory:'docs/jarvis-additional-requirements.json'},
    source_sha256:{spec:hash(ledger),matrix:hash(JSON.stringify(matrix)),
      decisions:hash(JSON.stringify(decisions)),reverse:hash(JSON.stringify(reverse)),cognitive:hash(JSON.stringify(cognitive)),inventory:hash(JSON.stringify(inventory))},
    classification:'DERIVED_REPOSITORY_AUDIT_NOT_FUNCTIONAL_EVIDENCE',
    product_complete:false,functional_completion_claim:false,
    summary:{total:requirements.length,statuses:counts,incomplete:requirements.filter(r=>r.canonical_status!=='VERIFIED').length,
      source_present_but_missing:requirements.filter(r=>r.boundary==='SOURCE_PRESENT_BUT_REQUIREMENT_UNVERIFIED').length,
      absent_evidence_leads:requirements.flatMap(r=>r.evidence_leads).filter(r=>r.kind==='MISSING_REPOSITORY_REFERENCE').length,
      cognitive_remaining:cognitive.components.length,families},
    requirements,cognitive:cognitive.components.map(c=>({id:c.id,title:c.title,states:c.states,
      owner_issues:[681,882,1216],implementation_refs:c.implementation_refs,test_refs:c.test_refs,
      evidence_refs:c.evidence_refs,remaining:c.remaining,acceptance:'BLOCKED'})),
    limitations:['Source/reference existence is not implementation completeness or deployed acceptance.',
      'Historical canonical VERIFIED records retain only their original source-revision scope.',
      'All P0-P10 exits, Goal Bridge A-J and distributed physical acceptance need their own actual evidence.',
      'Nubia and Android38 deferral is not PASS or PLATFORM_LIMITED.',
      'No approval, Controller/Compass state or runtime mutation is performed.']};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--check','--json'].includes(process.argv[2]))throw Error('Use --check or --json; no mutation mode');
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
    const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const audit=buildCompletionAudit({root,revision,matrix:read('docs/jarvis-requirements.json'),
      ledger:fs.readFileSync(path.join(root,'docs/JARVIS_PRODUCT_SPEC.md'),'utf8'),
      inventory:read('docs/jarvis-additional-requirements.json'),decisions:read('docs/jarvis-owner-decisions.json'),
      reverse:read('docs/jarvis-reverse-traceability.json'),cognitive:read('docs/goriq-cognitive-status.json')});
    console.log(JSON.stringify(process.argv[2]==='--json'?audit:{status:'PASS',...audit.summary,
      product_complete:false,functional_completion_claim:false},null,process.argv[2]==='--json'?2:undefined));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
