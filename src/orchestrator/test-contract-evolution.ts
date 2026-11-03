export interface TestContractEvolutionInput {
  failureKind: "assertion_mismatch" | "compile" | "runtime" | "unknown";
  canonicalRequirementChanged: boolean;
  implementationVerificationPassed: boolean;
  proposedTestPatch: string;
}
export interface TestContractEvolutionDecision { allowed: boolean; reason: string; }
export interface BuilderTestContractEvolutionEvidence {
  failureKind: TestContractEvolutionInput["failureKind"];
  canonicalRequirementChanged: boolean;
  implementationVerificationPassed: boolean;
  verifierId: string;
  sourceRevision: string;
  artifactDigest: string;
}

const weakeningPatterns=[/\.skip\s*\(/,/test\.skip\s*\(/,/describe\.skip\s*\(/,/assert\.ok\s*\(\s*true\s*\)/,/assert\.equal\s*\(\s*true\s*,\s*true\s*\)/,/TODO.*disable/i];

export function evaluateTestContractEvolution(input:TestContractEvolutionInput):TestContractEvolutionDecision{
 if(input.failureKind!=="assertion_mismatch")return{allowed:false,reason:"Only assertion-contract drift may evolve tests automatically"};
 if(!input.canonicalRequirementChanged)return{allowed:false,reason:"Canonical requirement/spec change evidence is required"};
 if(!input.implementationVerificationPassed)return{allowed:false,reason:"Implementation must independently verify before a test contract can evolve"};
 if(!input.proposedTestPatch.trim())return{allowed:false,reason:"A concrete test patch is required"};
 if(weakeningPatterns.some(p=>p.test(input.proposedTestPatch)))return{allowed:false,reason:"Proposed test patch weakens or bypasses verification"};
 const removedAssertions=(input.proposedTestPatch.match(/^[-].*assert\./gm)||[]).length;
 const addedAssertions=(input.proposedTestPatch.match(/^[+].*assert\./gm)||[]).length;
 if(removedAssertions>0&&addedAssertions===0)return{allowed:false,reason:"Assertions cannot be removed without replacement"};
 return{allowed:true,reason:"Canonical contract changed and the replacement test preserves verification strength"};
}

export function evaluateBuilderTestContractEvolution(input:{
  builderId:string;
  proposedTestPatch:string;
  evidence?:BuilderTestContractEvolutionEvidence;
}):TestContractEvolutionDecision{
 const builderId=input.builderId.trim();
 if(!builderId)return{allowed:false,reason:"Builder identity is required"};
 const evidence=input.evidence;
 if(!evidence)return{allowed:false,reason:"Independent test-contract evolution evidence is required"};
 const verifierId=evidence.verifierId.trim();
 if(!verifierId||verifierId===builderId)return{allowed:false,reason:"Builder cannot verify its own test-contract evolution"};
 if(!/^[a-f0-9]{40,64}$/.test(evidence.sourceRevision)||!/^[a-f0-9]{64}$/.test(evidence.artifactDigest)){
  return{allowed:false,reason:"Test-contract evolution evidence must bind an exact verified revision and artifact"};
 }
 return evaluateTestContractEvolution({
  failureKind:evidence.failureKind,
  canonicalRequirementChanged:evidence.canonicalRequirementChanged,
  implementationVerificationPassed:evidence.implementationVerificationPassed,
  proposedTestPatch:input.proposedTestPatch,
 });
}

export function extractBuilderTestContractEvolutionEvidence(context:unknown):BuilderTestContractEvolutionEvidence|undefined{
 if(!Array.isArray(context))return undefined;
 const matches=context.flatMap((entry)=>{
  if(!entry||typeof entry!=="object"||Array.isArray(entry))return[];
  const item=entry as {source?:unknown;data?:unknown};
  if(item.source!=="development.test_contract_evolution"||!item.data||typeof item.data!=="object"||Array.isArray(item.data))return[];
  const data=item.data as Record<string,unknown>;
  if(data.verified!==true
    || !["assertion_mismatch","compile","runtime","unknown"].includes(String(data.failureKind))
    || typeof data.canonicalRequirementChanged!=="boolean"
    || typeof data.implementationVerificationPassed!=="boolean"
    || typeof data.verifierId!=="string"
    || typeof data.sourceRevision!=="string"
    || typeof data.artifactDigest!=="string")return[];
  return[{
    failureKind:data.failureKind as BuilderTestContractEvolutionEvidence["failureKind"],
    canonicalRequirementChanged:data.canonicalRequirementChanged,
    implementationVerificationPassed:data.implementationVerificationPassed,
    verifierId:data.verifierId,
    sourceRevision:data.sourceRevision,
    artifactDigest:data.artifactDigest,
  }];
 });
 return matches.length===1?matches[0]:undefined;
}
