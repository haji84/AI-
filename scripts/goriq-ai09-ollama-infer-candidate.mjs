import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

// Development-only candidate. No production reviewer, scheduler, deployment,
// workflow permissions or GitHub approval path imports this module.
const sha256 = /^[0-9a-f]{64}$/u;
const modelPattern = /^[A-Za-z0-9_.:/-]{1,96}$/u;
const fail = code => { throw Error(code); };

async function boundedJSON(response, limit) {
  if (!response?.ok) fail('AI09_MODEL_ENDPOINT_REJECTED');
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) fail('AI09_MODEL_RESPONSE_OVERSIZED');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) fail('AI09_MODEL_RESPONSE_OVERSIZED');
    try { return JSON.parse(text); } catch { fail('AI09_MODEL_RESPONSE_INVALID'); }
  }
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !(value instanceof Uint8Array)) fail('AI09_MODEL_RESPONSE_INVALID');
      length += value.byteLength;
      if (length > limit) fail('AI09_MODEL_RESPONSE_OVERSIZED');
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { fail('AI09_MODEL_RESPONSE_INVALID'); }
}

/**
 * Restricted adapter for a future owner-approved isolated model canary.
 * Only a numeric IPv4 loopback endpoint is accepted, with no credentials,
 * redirects, non-local fallback, or model auto-download.
 * Digest is reported by Ollama itself, NOT trusted attestation of its binary.
 */
export function createCandidateOllamaInfer({ endpoint = 'http://127.0.0.1:11434',
  modelName, expectedDigest, fetchImpl = globalThis.fetch,
  timeoutMs = 150000, maxCalls = 1 } = {}) {
  const validOrigin = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?$/u.exec(endpoint);
  const port = validOrigin?.[1] === undefined ? 80 : Number(validOrigin[1]);
  if (!validOrigin || port > 65535 || port < 1 ||
      !modelPattern.test(modelName ?? '') || !sha256.test(expectedDigest ?? '') ||
      typeof fetchImpl !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 150000 ||
      !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 4096)
    fail('AI09_MODEL_ADAPTER_SCOPE_INVALID');
  let calls = 0;
  const fetchLocal = async(path, body) => {
    try {
      return await fetchImpl(endpoint + path, {
        method:body ? 'POST':'GET',
        redirect:'error',
        headers:body ? { 'Content-Type':'application/json' } : {},
        ...(body ? { body:JSON.stringify(body) } : {}),
        signal:AbortSignal.timeout(timeoutMs),
      });
    } catch { fail('AI09_LOCAL_MODEL_UNAVAILABLE'); }
  };
  const infer = async(prompt) => {
    if (typeof prompt !== 'string' || !prompt.trim() ||
        Buffer.byteLength(prompt, 'utf8') > 12000) fail('AI09_REVIEW_PROMPT_INVALID');
    if (calls >= maxCalls) fail('AI09_LOCAL_INFERENCE_BUDGET_EXHAUSTED');
    calls++;
    // Validate the exact local model claim BEFORE transmitting source.
    const catalog = await boundedJSON(await fetchLocal('/api/tags'), 64 * 1024);
    const models = catalog?.models;
    if (!Array.isArray(models) || models.length > 512 ||
        models.filter(m => m?.name === modelName).length !== 1 ||
        models.find(m => m?.name === modelName)?.digest !== expectedDigest)
      fail('AI09_LOCAL_MODEL_DIGEST_MISMATCH');
    const response = await boundedJSON(await fetchLocal('/api/chat', {
      model:modelName,stream:false,format:'json',
      options:{temperature:0,num_ctx:8192,num_predict:768},
      messages:[{role:'user',content:prompt}],
    }), 48 * 1024);
    if (response?.model !== modelName || response?.done !== true ||
        response?.done_reason !== 'stop' ||
        typeof response.message?.content !== 'string' ||
        Buffer.byteLength(response.message.content, 'utf8') > 20000 ||
        !response.message.content.trim()) fail('AI09_LOCAL_MODEL_OUTPUT_UNVERIFIED');
    return response.message.content;
  };
  return { infer, identity:{ modelName, claimedDigest:expectedDigest,
    endpointKind:'NUMERIC_IPV4_LOOPBACK', independentModelVerified:false,
    signatureVerified:false, verificationSource:'LOCAL_PROVIDER_SELF_REPORT' } };
}
