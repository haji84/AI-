import type { WorkAction, WorkCapability, WorkResult, WorkVerifierContract } from "./work-capability.ts";

export interface SandboxDocument { title: string; sections: Record<string, string>; }

export class DocumentSandboxCapability implements WorkCapability {
  readonly name="document.write"; readonly domain="document" as const; readonly operations=["write_sections"];
  readonly access="write" as const; readonly externalSideEffect=false; readonly maxRisk="low" as const; readonly requiresHumanApproval=false;
  private readonly document: SandboxDocument;
  constructor(document: SandboxDocument){ this.document=document; }
  async available(){ return true; }
  async execute(action: WorkAction): Promise<WorkResult> {
    const sections=action.input.sections;
    if(action.operation!=="write_sections" || !sections || typeof sections!=="object" || Array.isArray(sections)) return {ok:false,status:"failed",outputs:{},changes:[],evidence:[],failureClass:"implementation",error:"invalid document sections",provenance:{capability:this.name,attemptId:action.attemptId,strategyId:action.strategyId}};
    for(const [name,value] of Object.entries(sections)) this.document.sections[name]=String(value);
    return {ok:true,status:"completed",outputs:{document:structuredClone(this.document)},changes:Object.keys(sections).map(name=>({resource:`section:${name}`,operation:"write",reversible:true,rollbackHint:"restore sandbox document"})),evidence:[{kind:"document.snapshot",data:structuredClone(this.document)}],provenance:{capability:this.name,attemptId:action.attemptId,strategyId:action.strategyId}};
  }
}

export function verifyDocument(document: SandboxDocument, contract: WorkVerifierContract) {
  if(contract.kind!=="document.required_sections") return {ok:false,summary:"unsupported document verifier",evidence:{kind:contract.kind}};
  const required=Array.isArray(contract.spec.sections)?contract.spec.sections.map(String):[];
  const missing=required.filter(name=>!document.sections[name]?.trim());
  return {ok:missing.length===0,summary:missing.length?"document missing required sections":"document verification passed",evidence:{kind:"document.required_sections",missing,required}};
}
