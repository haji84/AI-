import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateOllamaInfer } from '../scripts/goriq-ai09-ollama-infer-candidate.mjs';

const digest='a'.repeat(64);
const modelName='qwen2.5-coder:3b';
const api = (value, ok = true) => ({
  ok,headers:{get:()=>null},text:async()=>JSON.stringify(value),
});
const tags = { models:[{name:modelName,digest}] };
const chat = { model:modelName,done:true,done_reason:'stop',
  message:{content:JSON.stringify({verdict:'NO_FINDINGS',findings:[]})} };

test('the candidate checks the claimed digest before a single real-format JSON reply', async()=>{
  const paths=[];
  const fetchImpl=async (url, options) => {
    paths.push({url,method:options.method,redirect:options.redirect,
      headers:options.headers, ...(options.body ? {body:JSON.parse(options.body)} : {})});
    return url.endsWith('/api/tags') ? api(tags) : api(chat);
  };
  const adapter=createCandidateOllamaInfer({modelName,expectedDigest:digest,fetchImpl});
  const response=await adapter.infer('Review synthetic safe sample');
  assert.equal(JSON.parse(response).verdict,'NO_FINDINGS');
  assert.equal(paths.length,2);
  assert.deepEqual(paths.map(x=>x.url),[
    'http://127.0.0.1:11434/api/tags','http://127.0.0.1:11434/api/chat']);
  assert.ok(paths.every(x=>x.redirect==='error'));
  assert.equal(paths[1].body.options.temperature,0);
  assert.equal(paths[1].body.stream,false);
  assert.equal(adapter.identity.independentModelVerified,false);
  await assert.rejects(adapter.infer('again'),/AI09_LOCAL_INFERENCE_BUDGET_EXHAUSTED/);
});

test('reject DNS, public addresses, alternate protocols, malformed digest and excess budgets',()=>{
  for (const endpoint of ['https://127.0.0.1:11434','http://localhost:11434',
    'http://192.168.1.2:11434','http://127.0.0.1:11434/path',
    'http://127.0.0.1:0','http://127.0.0.1:99999']) {
    assert.throws(()=>createCandidateOllamaInfer({endpoint,modelName,expectedDigest:digest}));
  }
  assert.throws(()=>createCandidateOllamaInfer({modelName,expectedDigest:'bad'}));
  assert.throws(()=>createCandidateOllamaInfer({modelName,expectedDigest:digest,maxCalls:0}));
});

test('incorrect model identity forbids source transmission',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);
    return api({models:[{name:modelName,digest:'f'.repeat(64)}]});
  };
  const adapter=createCandidateOllamaInfer({modelName,expectedDigest:digest,fetchImpl});
  await assert.rejects(adapter.infer('synthetic source'),/AI09_LOCAL_MODEL_DIGEST_MISMATCH/);
  assert.equal(calls.length,1);
});

test('model output must be complete, named, bounded JSON over local loopback',async()=>{
  for (const altered of [
    {...chat,done_reason:'length'},
    {...chat,done:false},
    {...chat,model:'wrong-model'},
    {...chat,message:{content:'x'.repeat(20001)}},
  ]) {
    const adapter=createCandidateOllamaInfer({
      modelName,expectedDigest:digest,
      fetchImpl:async url=>url.endsWith('/api/tags')?api(tags):api(altered),
    });
    await assert.rejects(adapter.infer('synthetic source'),/AI09_LOCAL_MODEL_OUTPUT_UNVERIFIED/);
  }
  const adapter=createCandidateOllamaInfer({modelName,expectedDigest:digest,
    fetchImpl:async()=>{throw Error('sensitive transport detail');}});
  await assert.rejects(adapter.infer('synthetic source'),e=>
    e.message==='AI09_LOCAL_MODEL_UNAVAILABLE');
});
