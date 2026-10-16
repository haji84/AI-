import test from "node:test";
import assert from "node:assert/strict";
import {runProbe, summarize, scenarios} from "../scripts/goriq-ai09-hosted-benchmark.mjs";

test("the benchmark includes safe code, sensitive logging and command injection", () => {
 assert.deepEqual(scenarios.map(s=>s.id),["SAFE_ADDITION","SENSITIVE_LOGGING","COMMAND_INJECTION"]);
 assert.ok(scenarios.every(s=>s.patch.length<4096 && s.path.startsWith("src/")));
});
test("summaries never authorize merge or mistake partial coverage for success",()=>{
 const xs=scenarios.map(s=>({id:s.id,expected:s.expected,status:s.expected,latencyMs:20,peakUsedMemMiB:100,numberOfFindings:s.expected==="CHANGES_REQUESTED"?1:0}));
 const s=summarize(xs);
 assert.equal(s.passesThisProbe,true);
 assert.equal(s.mergeAuthorized,false);
 assert.equal(s.githubApprovalSatisfied,false);
 assert.equal(s.total,3);
 assert.equal(s.maxObservedUsedMemMiB,100);
 assert.equal(summarize(xs.map((v,i)=>i===1?{...v,status:"INCONCLUSIVE"}:v)).passesThisProbe,false);
 assert.throws(()=>summarize(xs.slice(1)),/missing_scenario/);
});
test("actual existing AI-09 review parser is exercised on mocked inference, no remote model",async()=>{
 const response=await runProbe({
  infer:async prompt=>{
   const path=scenarios.find(s=>prompt.includes("Changed paths: "+JSON.stringify([s.path])));
   if(!path)throw Error("unexpected scenario");
   return JSON.stringify(path.expected==="NO_ACTIONABLE_FINDINGS"?
    {verdict:"NO_FINDINGS",findings:[]}:
    {verdict:"CHANGES_REQUESTED",findings:[{path:path.path,line:1,severity:"high",
      summary:"Unsafe input or credential logging",evidence:"Unsafe added code line",
      proposedFix:"Remove the unsafe operation and add tests"}]});
  },
  sampleMemory:()=>42,
 });
 assert.equal(response.passesThisProbe,true);
 assert.deepEqual(response.outcomes.map(o=>o.status),scenarios.map(s=>s.expected));
});
test("invalid local model response never becomes success",async()=>{
 const s=await runProbe({infer:async()=>"{not-json",sampleMemory:()=>42});
 assert.equal(s.passesThisProbe,false);
 assert.ok(s.outcomes.every(o=>o.status==="BLOCKED"));
});
