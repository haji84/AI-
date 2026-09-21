export type InputRole="current"|"reference"|"other-case"|"unknown";
export type EvidenceClass="CONFIRMED"|"INFERRED"|"UNKNOWN"|"CONFLICTED";
export type InputDocument={id:string;name:string;content:Record<string,unknown>;modifiedAt?:string;version?:string;caseId?:string;declaredRole?:InputRole};
export type RecoveredField={field:string;value?:unknown;state:EvidenceClass;sources:string[];conflicts?:unknown[]};

function versionWeight(v?:string){ if(!v)return 0; const m=v.match(/\d+(?:\.\d+)*/); return m?m[0].split(".").reduce((a,n)=>a*100+Number(n),0):0; }
export class InputRecoveryEngine {
  auditInputSet(requiredNames:string[],docs:InputDocument[],currentCaseId?:string){
    const normalized=(s:string)=>s.trim().toLowerCase();
    const present=new Map<string,InputDocument[]>();
    for(const d of docs){const key=normalized(d.name);const list=present.get(key)||[];list.push(d);present.set(key,list);}
    const missing=requiredNames.filter(name=>!present.has(normalized(name)));
    const duplicates=[...present.entries()].filter(([,items])=>items.length>1).map(([name,items])=>({name,ids:items.map(x=>x.id)}));
    const roles={current:[] as string[],reference:[] as string[],"other-case":[] as string[],unknown:[] as string[]};
    for(const d of docs)roles[this.classify(d,currentCaseId)].push(d.id);
    return {missing,duplicates,roles,complete:missing.length===0};
  }
  classify(doc:InputDocument,currentCaseId?:string):InputRole{
    if(doc.declaredRole&&doc.declaredRole!=="unknown") return doc.declaredRole;
    if(currentCaseId&&doc.caseId===currentCaseId) return "current";
    if(doc.name.toLowerCase().includes("reference")||doc.name.includes("参考")) return "reference";
    if(currentCaseId&&doc.caseId&&doc.caseId!==currentCaseId) return "other-case";
    return "unknown";
  }
  newest(docs:InputDocument[]){ return [...docs].sort((a,b)=>versionWeight(b.version)-versionWeight(a.version)||(Date.parse(b.modifiedAt||"")||0)-(Date.parse(a.modifiedAt||"")||0))[0]; }
  recover(docs:InputDocument[],currentCaseId?:string):RecoveredField[]{
    const current=docs.filter(d=>this.classify(d,currentCaseId)==="current");
    const fields=new Set(current.flatMap(d=>Object.keys(d.content)));
    const out:RecoveredField[]=[];
    for(const field of fields){
      const values=current.flatMap(d=>d.content[field]===undefined?[]:[{id:d.id,value:d.content[field]}]);
      if(!values.length){out.push({field,state:"UNKNOWN",sources:[]});continue;}
      const groups=new Map<string,{value:unknown,sources:string[]}>(); for(const v of values){const k=JSON.stringify(v.value);const g=groups.get(k)||{value:v.value,sources:[]};g.sources.push(v.id);groups.set(k,g);}
      if(groups.size===1){const g=[...groups.values()][0]; out.push({field,value:g.value,state:"CONFIRMED",sources:g.sources});}
      else {const gs=[...groups.values()];out.push({field,state:"CONFLICTED",sources:gs.flatMap(g=>g.sources),conflicts:gs.map(g=>g.value)});}
    }
    return out;
  }
  reconstruct(required:string[],recovered:RecoveredField[]){const map=new Map(recovered.map(x=>[x.field,x]));return required.map(field=>map.get(field)||{field,state:"UNKNOWN" as const,sources:[]});}
}
