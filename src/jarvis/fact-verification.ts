export type ClaimType = "law" | "product-spec" | "finance" | "science" | "performance" | "general" | "numeric";
export type EvidenceStatus = "VERIFIED" | "SUPPORTED" | "INFERRED" | "CONFLICTED" | "UNKNOWN" | "STALE";

export type FactClaim = {
  id: string;
  text: string;
  type: ClaimType;
  asOf?: string;
  numericExpression?: { expected: number; tolerance?: number };
};

export type FactSource = {
  id: string;
  originId: string;
  publisher: string;
  sourceType: "primary" | "official" | "research" | "independent-test" | "secondary";
  publishedAt?: string;
  effectiveAt?: string;
  retrievedAt: string;
  version?: string;
  passage: string;
  supports: string[];
  contradicts?: string[];
};

export type FactEvidence = {
  claimId: string;
  sourceId: string;
  authority: number;
  independentOrigin: string;
  fresh: boolean;
  entails: boolean;
  contradicts: boolean;
};

export type VerificationDepth="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
export type FactSourceRetriever=(claim:FactClaim,depth:VerificationDepth)=>Promise<FactSource[]>;

export type FactAudit = {
  claim: FactClaim;
  status: EvidenceStatus;
  confidence: number;
  evidence: FactEvidence[];
  reasons: string[];
  numericCheck?: { ok: boolean; actual?: number };
};

const authorityByType: Record<ClaimType, Partial<Record<FactSource["sourceType"], number>>> = {
  law: { primary: 1, official: 0.95, research: 0.5, "independent-test": 0.3, secondary: 0.25 },
  "product-spec": { official: 1, primary: 0.95, "independent-test": 0.7, research: 0.5, secondary: 0.3 },
  finance: { primary: 1, official: 0.95, research: 0.6, "independent-test": 0.4, secondary: 0.3 },
  science: { research: 1, primary: 0.85, official: 0.75, "independent-test": 0.7, secondary: 0.4 },
  performance: { "independent-test": 1, official: 0.7, research: 0.75, primary: 0.65, secondary: 0.4 },
  general: { primary: 0.9, official: 0.9, research: 0.85, "independent-test": 0.8, secondary: 0.55 },
  numeric: { primary: 0.95, official: 0.95, research: 0.9, "independent-test": 0.9, secondary: 0.6 },
};

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean));
}
function entailment(claim: string, passage: string): boolean {
  const c=tokens(claim), p=tokens(passage);
  if (!c.size) return false;
  let matched=0;
  for (const t of c) if (p.has(t)) matched++;
  return matched / c.size >= 0.55;
}
function isFresh(source: FactSource, claim: FactClaim, now = Date.now()): boolean {
  const anchor = source.effectiveAt || source.publishedAt || source.retrievedAt;
  const sourceTime = Date.parse(anchor);
  if (!Number.isFinite(sourceTime)) return false;
  if (claim.asOf) {
    const target=Date.parse(claim.asOf);
    if (Number.isFinite(target) && sourceTime > target + 24*60*60*1000) return false;
  }
  const maxAge = claim.type === "law" || claim.type === "product-spec" || claim.type === "finance" ? 365*24*60*60*1000 : 3*365*24*60*60*1000;
  return now - sourceTime <= maxAge;
}

export class FactVerificationEngine {
  private readonly deterministicCalculator?: (claim: FactClaim) => Promise<number | undefined>;
  private readonly retriever?: FactSourceRetriever;

  constructor(deterministicCalculator?: (claim: FactClaim) => Promise<number | undefined>, retriever?: FactSourceRetriever) {
    this.deterministicCalculator = deterministicCalculator;
    this.retriever = retriever;
  }

  classifyClaim(text:string):ClaimType {
    const lower=text.toLowerCase();
    if(/\b(law|act|regulation|ordinance|法|条例|規則)\b/u.test(lower))return "law";
    if(/\b(revenue|profit|earnings|売上|利益|決算)\b/u.test(lower))return "finance";
    if(/\b(study|trial|research|研究|試験|論文)\b/u.test(lower))return "science";
    if(/\b(spec|仕様|version|型番|メーカー)\b/u.test(lower))return "product-spec";
    if(/\b(performance|benchmark|性能|速度|精度)\b/u.test(lower))return "performance";
    if(/\d/.test(text))return "numeric";
    return "general";
  }

  extractClaims(text:string):FactClaim[] {
    return text.split(/(?<=[。！？.!?])\s*|\n+/u).map(x=>x.trim()).filter(x=>x.length>=4).map((sentence,index)=>({
      id:`claim-${index+1}`,
      text:sentence,
      type:this.classifyClaim(sentence),
    }));
  }

  verificationDepth(claim:FactClaim,input:{risk?:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";freshnessCritical?:boolean}={}):VerificationDepth {
    if(input.risk==="CRITICAL")return "CRITICAL";
    if(input.risk==="HIGH"||claim.type==="law"||claim.type==="finance")return "HIGH";
    if(input.freshnessCritical||claim.type==="science"||claim.type==="performance")return "MEDIUM";
    return "LOW";
  }

  async verifyText(text:string,input:{risk?:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";freshnessCritical?:boolean;now?:number}={}){
    const claims=this.extractClaims(text);const audits:FactAudit[]=[];
    for(const claim of claims){
      const depth=this.verificationDepth(claim,input);
      const sources=this.retriever?await this.retriever(claim,depth):[];
      audits.push(await this.audit(claim,sources,input.now??Date.now()));
    }
    return {claims,audits,graph:this.evidenceGraph(audits)};
  }

  sourceAuthority(claim: FactClaim, source: FactSource): number {
    return authorityByType[claim.type][source.sourceType] ?? 0.2;
  }

  evidenceFor(claim: FactClaim, source: FactSource, now = Date.now()): FactEvidence {
    return {
      claimId: claim.id,
      sourceId: source.id,
      authority: this.sourceAuthority(claim, source),
      independentOrigin: source.originId,
      fresh: isFresh(source, claim, now),
      entails: source.supports.includes(claim.id) && entailment(claim.text, source.passage),
      contradicts: source.contradicts?.includes(claim.id) === true,
    };
  }

  async audit(claim: FactClaim, sources: FactSource[], now = Date.now()): Promise<FactAudit> {
    const evidence=sources.map(s=>this.evidenceFor(claim,s,now));
    const uniqueOrigins=new Map<string,FactEvidence>();
    for (const e of evidence) {
      const current=uniqueOrigins.get(e.independentOrigin);
      if (!current || current.authority<e.authority) uniqueOrigins.set(e.independentOrigin,e);
    }
    const independent=[...uniqueOrigins.values()];
    const positive=independent.filter(e=>e.entails && !e.contradicts);
    const negative=independent.filter(e=>e.contradicts);
    const stalePositive=positive.filter(e=>!e.fresh);
    const freshPositive=positive.filter(e=>e.fresh);
    const reasons:string[]=[];
    let numericCheck: FactAudit["numericCheck"];
    if (claim.numericExpression && this.deterministicCalculator) {
      const actual=await this.deterministicCalculator(claim);
      if (actual!==undefined) {
        const tolerance=claim.numericExpression.tolerance ?? 0;
        numericCheck={ok:Math.abs(actual-claim.numericExpression.expected)<=tolerance,actual};
        if (!numericCheck.ok) reasons.push("deterministic numeric validation failed");
      }
    }
    let status:EvidenceStatus="UNKNOWN";
    if (negative.length && positive.length) status="CONFLICTED";
    else if (numericCheck?.ok && freshPositive.some(e=>e.authority>=0.9)) status="VERIFIED";
    else if (freshPositive.length>=2 && freshPositive.some(e=>e.authority>=0.8)) status="SUPPORTED";
    else if (freshPositive.length===1) status=freshPositive[0].authority>=0.9 ? "SUPPORTED" : "INFERRED";
    else if (stalePositive.length) status="STALE";
    if (negative.length) reasons.push("contradicting independent evidence exists");
    if (!freshPositive.length && stalePositive.length) reasons.push("supporting evidence is stale");
    const quality=freshPositive.reduce((a,e)=>a+e.authority,0);
    const independence=Math.min(1,freshPositive.length/3);
    const conflictPenalty=Math.min(0.6,negative.length*0.2);
    const numericBonus=numericCheck?.ok ? 0.15 : 0;
    const confidence=Math.max(0,Math.min(1,(quality/(Math.max(1,freshPositive.length)))*0.65+independence*0.2+numericBonus-conflictPenalty));
    return {claim,status,confidence:Number(confidence.toFixed(3)),evidence,reasons,numericCheck};
  }

  evidenceGraph(audits: FactAudit[]) {
    return audits.map(a=>({
      claimId:a.claim.id,
      status:a.status,
      confidence:a.confidence,
      edges:a.evidence.map(e=>({sourceId:e.sourceId,relation:e.contradicts?"CONTRADICTS":e.entails?"SUPPORTS":"MENTIONS",authority:e.authority,fresh:e.fresh}))
    }));
  }
}
