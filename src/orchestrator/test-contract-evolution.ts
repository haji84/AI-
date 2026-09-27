export interface TestContractEvolutionInput {
  failureKind: "assertion_mismatch" | "compile" | "runtime" | "unknown";
  canonicalRequirementChanged: boolean;
  implementationVerificationPassed: boolean;
  proposedTestPatch: string;
}
export interface TestContractEvolutionDecision { allowed: boolean; reason: string; }
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
