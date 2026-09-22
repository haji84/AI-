import { createHash } from 'node:crypto';
import type { WorkStateStore } from './work-state.ts';
import type { ActionResult, ProposedAction, StateStore, VerificationResult } from './goal-loop.ts';
import { runProductionResearch, type ProductionResearchClaim } from './production-research.ts';
import { researchUrl, type ResearchTransportOptions } from './research-transport.ts';
import { verifyFacts, type FactClaim, type SourceClass } from './fact-verifier.ts';

interface SourcePolicy { url: string; sourceClass: SourceClass; fields: string[]; }
interface Receipt { binding: string | null; digest: string; claims: FactClaim[]; evidence: unknown; ok: boolean; }
const classes = new Set<SourceClass>(['primary_original','official','reliable_secondary','other']);
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function fingerprint(value: unknown): string | null { try { return digest(value); } catch { return null; } }
function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid object');
 return value as Record<string, unknown>;
}
function boundedJson(value: unknown, maximum: number) {
 const serialized=JSON.stringify(value);
 if (!serialized || Buffer.byteLength(serialized,'utf8')>maximum) throw new Error('input budget');
 return serialized;
}
function publicUrl(value: unknown): string {
 if (typeof value !== 'string') throw new Error('invalid URL');
 const url=new URL(value);
 // Public evidence only; query credentials and request-generated egress are not supported.
 if (url.search || url.hash) throw new Error('source query/fragment forbidden');
 return researchUrl(value,[url.origin]).href;
}
function sourcePolicy(raw: string | undefined): SourcePolicy[] {
 if (!raw || Buffer.byteLength(raw,'utf8')>32_768) throw new Error('source policy unavailable');
 const parsed=object(JSON.parse(raw));
 if (parsed.version!==1 || !Array.isArray(parsed.sources) || !parsed.sources.length || parsed.sources.length>40) throw new Error('invalid source policy');
 const seen=new Set<string>();
 return parsed.sources.map(value=>{
  const source=object(value); const url=publicUrl(source.url);
  if (seen.has(url) || !classes.has(source.sourceClass as SourceClass) || !Array.isArray(source.fields) || !source.fields.length || source.fields.length>40 || source.fields.some(f=>typeof f!=='string' || !f || f.length>128 || ['__proto__','constructor','prototype'].includes(f))) throw new Error('invalid source policy');
  seen.add(url); return {url,sourceClass:source.sourceClass as SourceClass,fields:source.fields as string[]};
 });
}
function claimsOf(value: unknown, policy: SourcePolicy[]): ProductionResearchClaim[] {
 const input=object(value); boundedJson(input,16_384);
 if (Object.keys(input).some(k=>k!=='claims') || !Array.isArray(input.claims) || !input.claims.length || input.claims.length>20) throw new Error('invalid fact contract');
 const claims=input.claims.map(value=>{
  const c=object(value);
  if (Object.keys(c).some(k=>!['id','value','required','jsonField','sources','publishedAtField','maxAgeMs'].includes(k)) || !Array.isArray(c.sources)) throw new Error('invalid claim');
  const sources=c.sources.map(value=>{
   const s=object(value);
   if (Object.keys(s).some(k=>!['url','sourceClass'].includes(k))) throw new Error('invalid source');
   const url=publicUrl(s.url); const approved=policy.find(p=>p.url===url && p.fields.includes(c.jsonField as string));
   if (!approved) throw new Error('source/field denied');
   return {url,sourceClass:approved.sourceClass};
  });
  return {...c,sources} as unknown as ProductionResearchClaim;
 });
 if (!claims.some(c=>c.required===true)) throw new Error('required claim missing');
 return claims;
}
function researchRequest(action: ProposedAction): boolean {
 const input=action.input;
 return action.capability==='autonomy.delegate' && !!input && typeof input==='object' && !Array.isArray(input)
  && (input as {target?:unknown}).target==='research' && Object.hasOwn(input,'factCheck');
}
function binding(action: ProposedAction) { return fingerprint({id:action.id,capability:action.capability,input:action.input}); }

/** Host-created runtime. Payloads and retrieved content cannot supply policy or transport. */
export function createResearchDelegationRuntime(options: {
 env: Record<string,string|undefined>;
 transport?: Pick<ResearchTransportOptions,'resolve'|'fetchImpl'|'maxBytes'|'timeoutMs'>;
}) {
 const receipts=new WeakMap<ActionResult,Receipt>();
 // Snapshot host policy at construction; request data never changes it.
 const policyJson=options.env.JARVIS_RESEARCH_SOURCE_POLICY_JSON;
 const transport={...options.transport};
 const runtime={
  async execute(action: ProposedAction): Promise<ActionResult> {
   const originalId=action.id;
   const originalBinding=binding(action);
   let facts: FactClaim[]=[]; let evidence: unknown;
   let ok=false; let blocker='RESEARCH_ACQUISITION_FAILED';
   try {
    if (!originalBinding) throw new Error('invalid action');
    const snapshot=structuredClone(action.input);
    const policy=sourcePolicy(policyJson);
    const input=object(snapshot);
    const claims=claimsOf(input.factCheck,policy);
    const result=await runProductionResearch({
     ...transport,claims,allowedOrigins:[...new Set(policy.map(p=>new URL(p.url).origin))],
     classify:url=>policy.find(p=>p.url===url.href)?.sourceClass ?? 'other',
    });
    facts=structuredClone(result.verification.claims); ok=result.verification.ok; blocker='RESEARCH_FACTS_UNVERIFIED';
    evidence={
     kind:'bounded-fact-research',version:1,actionId:originalId,trust:'reference_only_no_authority',
     claims:facts.map(c=>({id:c.id,required:c.required,status:c.status,valueSha256:digest(c.value),sourceIds:c.sources.map(s=>s.id)})),
     citations:result.evidence,blocked:result.verification.blocked,
    };
   } catch {
    // Native errors can include URLs, headers, payloads and credentials. Preserve a safe failure category only.
    evidence={kind:'bounded-fact-research',version:1,actionId:originalId,trust:'reference_only_no_authority',claims:[],citations:[],blocked:['acquisition_failed']};
   }
   const result: ActionResult={actionId:originalId,ok,summary:ok?'Bounded public facts verified':'Research facts unverified; acquisition or evidence requirements were not met',...(ok?{}:{blocker}),evidence};
   receipts.set(result,{binding:originalBinding,digest:digest(evidence),claims:facts,evidence:structuredClone(evidence),ok});
   return result;
  },
  verify(input: {action: ProposedAction;result: ActionResult}): VerificationResult | null {
   const {action,result}=input; const receipt=receipts.get(result);
   if (!researchRequest(action) && !receipt) return null;
   if (!receipt || !receipt.binding || receipt.binding!==binding(action) || receipt.digest!==fingerprint(result.evidence) || result.actionId!==action.id || result.ok!==receipt.ok) {
    return {ok:false,summary:'Research result provenance is unverified',evidence:{kind:'bounded-fact-research',blocked:['receipt_mismatch']}};
   }
   // Verify only the privately retained acquired values; never trust a caller-supplied PASS/status.
   const checked=verifyFacts(receipt.claims);
   const ok=receipt.ok && checked.claims.some(c=>c.required) && checked.claims.every(c=>!c.required || (c.status==='CONFIRMED' && c.sources.some(s=>s.sourceClass!=='other')));
   return {ok,summary:ok?'Bounded public facts independently verified':'Research facts remain unverified',evidence:structuredClone(receipt.evidence)};
  },
  withWriteBack(inner: StateStore, workState?: { store: WorkStateStore; goalId: string }): StateStore {
   return {
    getState:()=>inner.getState(),
    async writeBack(record) {
     const verification=record.action && record.result ? runtime.verify({action:record.action,result:record.result}) : null;
     // Goal Loop skips its verifier on failed execution. Persist its research failure evidence too.
     const effective = verification && (!record.verification || record.verification.ok) ? {...record,verification} : record;
     await inner.writeBack(effective);
     if (verification && workState) {
      // Keep failed acquisitions visible even when Goal Loop correctly skips its success verifier.
      await workState.store.appendEvent(workState.goalId, {
       id:'research-'+record.action!.id+'-'+Date.now(),at:new Date().toISOString(),type:'research_verification',
       summary:effective.verification!.summary,evidence:{verification:effective.verification,research:verification.evidence},
      });
     }
    },
   };
  },
 };
 return runtime;
}
