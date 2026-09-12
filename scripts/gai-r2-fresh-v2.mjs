import fs from 'node:fs';
import path from 'node:path';
import { benchmarkCases, suiteMeta } from '../benchmarks/internal/r2_v2/suite.mjs';
import { verifyTypedBenchmark } from '../src/gai/typed-benchmark-verifier.ts';
import { normalizeModelFinalOutput, extractBalancedJsonObject } from '../src/gai/model-output-normalizer.ts';
import { buildR2ImprovementEvidence } from '../src/gai/research-stage-evidence.ts';

const outDir=path.resolve('.gai-results');
const endpoint=(process.env.GAI_LOCAL_MODEL_ENDPOINT||'http://127.0.0.1:11434').replace(/\/$/,'');
const model=process.env.GAI_LOCAL_MODEL_NAME||'qwen3:4b';
if (process.env.R2_SAFETY_VERIFIED!=='1') throw new Error('R2 v2 requires safety regression verification');
fs.mkdirSync(outDir,{recursive:true});

const strategies=[
  {id:'strict-final', prompt:p=>`${p}\nReturn ONLY the final answer. No reasoning, markdown, labels, or extra punctuation.`, normalize:false},
  {id:'no-think-strict', prompt:p=>`${p}\n/no_think\nReturn ONLY the final answer. No reasoning, markdown, labels, or extra punctuation.`, normalize:false},
  {id:'no-think-conservative-normalizer', prompt:p=>`${p}\n/no_think\nReturn ONLY the final answer. No reasoning, markdown, labels, or extra punctuation.`, normalize:true},
];

async function runPrompt(prompt){
  const started=Date.now();
  const response=await fetch(`${endpoint}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,options:{temperature:0}}),signal:AbortSignal.timeout(120000)});
  if(!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body=await response.json();
  return {output:String(body.response??'').trim(),durationMs:Date.now()-started};
}
function verify(testCase, output, normalize){
  if(!normalize) return verifyTypedBenchmark(testCase.verifier,output);
  const cleaned=testCase.verifier.type==='json'?extractBalancedJsonObject(output):normalizeModelFinalOutput(output);
  return verifyTypedBenchmark(testCase.verifier,cleaned);
}
async function evaluate(cases,strategy,label){
  const results=[];
  for(const [index,testCase] of cases.entries()){
    let output='',error=null,durationMs=0,passed=false;
    try{const r=await runPrompt(strategy.prompt(testCase.prompt));output=r.output;durationMs=r.durationMs;passed=verify(testCase,output,strategy.normalize);}catch(e){error=e instanceof Error?e.message:String(e);}
    results.push({id:testCase.id,category:testCase.category,split:testCase.split,passed,output,error,durationMs,humanInterventions:0,additionalApiCost:0});
    console.log(`[R2v2 ${label} ${index+1}/${cases.length}] ${testCase.id} ${passed?'PASS':'FAIL'} ${strategy.id}`);
  }
  return results;
}
const score=r=>r.filter(x=>x.passed).length/r.length;
const totalMs=r=>r.reduce((s,x)=>s+x.durationMs,0);
const train=benchmarkCases.filter(c=>c.split==='train');
const validation=benchmarkCases.filter(c=>c.split==='validation');
const heldout=benchmarkCases.filter(c=>c.split==='heldout');

const trainTrials=[];
for(const strategy of strategies){const results=await evaluate(train,strategy,'TRAIN');trainTrials.push({strategyId:strategy.id,passRate:score(results),totalDurationMs:totalMs(results),results});}
trainTrials.sort((a,b)=>b.passRate-a.passRate||a.totalDurationMs-b.totalDurationMs||a.strategyId.localeCompare(b.strategyId));
const shortlist=trainTrials.slice(0,2).map(t=>strategies.find(s=>s.id===t.strategyId));
const validationTrials=[];
for(const strategy of shortlist){const results=await evaluate(validation,strategy,'VALIDATION');validationTrials.push({strategyId:strategy.id,passRate:score(results),totalDurationMs:totalMs(results),results});}
validationTrials.sort((a,b)=>b.passRate-a.passRate||a.totalDurationMs-b.totalDurationMs||a.strategyId.localeCompare(b.strategyId));
const selected=strategies.find(s=>s.id===validationTrials[0].strategyId);
if(!selected) throw new Error('R2 v2 candidate freeze failed');

// Candidate is frozen here. HELDOUT is touched only after this point.
const baselineStrategy={id:'baseline-raw',prompt:p=>p,normalize:false};
const baselineResults=await evaluate(heldout,baselineStrategy,'HELDOUT-BEFORE');
const candidateResults=await evaluate(heldout,selected,'HELDOUT-AFTER');
const heldoutBefore=score(baselineResults), heldoutAfter=score(candidateResults), gain=heldoutAfter-heldoutBefore;
const built=buildR2ImprovementEvidence({runId:`r2v2-${Date.now()}`,source:`fresh-v2:${model}:${selected.id}`,collectedAt:new Date().toISOString(),heldoutBefore,heldoutAfter,humanInterventionBefore:0,humanInterventionAfter:0,safetyRegression:false,additionalApiCost:0});
const report={schemaVersion:3,suite:suiteMeta,model,policy:'Fresh suite. Candidate shortlist uses TRAIN, final selection uses VALIDATION, candidate is frozen before HELDOUT. HELDOUT is evaluated once for baseline and once for the frozen candidate.',trainTrials:trainTrials.map(({results,...x})=>({...x,evaluated:results.length})),validationTrials:validationTrials.map(({results,...x})=>({...x,evaluated:results.length})),selectedStrategy:selected.id,heldoutTotal:heldout.length,heldoutBefore,heldoutAfter,gain,accepted:built.accepted,rejectionReasons:built.reasons,safetyRegression:false,additionalApiCost:0,baselineResults,candidateResults,completedAt:new Date().toISOString()};
fs.writeFileSync(path.join(outDir,'r2-v2-improvement-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(outDir,'research-evidence.json'),JSON.stringify(built.evidence,null,2));
console.log(JSON.stringify({selectedStrategy:selected.id,heldoutBefore,heldoutAfter,gain,accepted:built.accepted,rejectionReasons:built.reasons},null,2));
