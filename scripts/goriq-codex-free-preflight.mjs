/** Observation only. No inference, model pulls, writes, credentials or admission override. */
import { Buffer } from 'node:buffer';
import { request as requestHttp } from 'node:http';
import { freemem, totalmem, platform as nativePlatform } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';

const MAX_BYTES = 65536;
const ROUTES = new Set(['/api/tags', '/api/ps']);
const REASONS = new Set(['INVALID_ROUTE', 'INVALID_TIMEOUT', 'TIMEOUT', 'REQUEST_FAILED',
  'REDIRECT_REJECTED', 'HTTP_FAILED', 'RESPONSE_TOO_LARGE', 'INVALID_JSON', 'INVALID_SCHEMA']);
const diagnosticError = reason => Object.assign(new Error(reason), { diagnosticReason: reason });

/** Fixed loopback request; injection is for tests, never CLI or environment configuration. */
export async function readOllamaInventory(path, options = {}) {
  if (!ROUTES.has(path)) throw diagnosticError('INVALID_ROUTE');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw diagnosticError('INVALID_TIMEOUT');
  const requestImpl = options.requestImpl ?? requestHttp;
  return new Promise((resolve, reject) => {
    let request, response, settled = false;
    const timer = setTimeout(() => finish('TIMEOUT'), timeoutMs);
    function finish(reason, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (reason) {
        response?.destroy();
        request?.destroy();
        reject(diagnosticError(reason));
      } else resolve(result);
    }
    try {
      request = requestImpl({ protocol: 'http:', hostname: '127.0.0.1', port: 11434,
        path, method: 'GET', agent: false, headers: { accept: 'application/json' } }, incoming => {
        response = incoming;
        response.on('error', () => finish('REQUEST_FAILED'));
        response.on('aborted', () => finish('REQUEST_FAILED'));
        if (response.statusCode >= 300 && response.statusCode < 400) return finish('REDIRECT_REJECTED');
        if (response.statusCode !== 200) return finish('HTTP_FAILED');
        const length = response.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return finish('RESPONSE_TOO_LARGE');
        let bytes = 0;
        const chunks = [];
        response.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_BYTES) return finish('RESPONSE_TOO_LARGE');
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish('INVALID_JSON'); }
        });
      });
      request.on('error', () => finish('REQUEST_FAILED'));
      request.end();
    } catch { finish('REQUEST_FAILED'); }
  });
}

function normalizeModels(payload) {
  if (!payload || Array.isArray(payload) || !Array.isArray(payload.models) || payload.models.length > 256) {
    throw diagnosticError('INVALID_SCHEMA');
  }
  return payload.models.map(model => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) throw diagnosticError('INVALID_SCHEMA');
    const name = model.name ?? model.model;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(name)
      || name.includes('//') || name.includes('://')) throw diagnosticError('INVALID_SCHEMA');
    const digest = typeof model.digest === 'string' && /^(?:sha256:)?[a-fA-F0-9]{64}$/.test(model.digest)
      ? model.digest.replace(/^sha256:/, '').toLowerCase() : null;
    const bytes = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { name, digest, sizeBytes: bytes(model.size), vramBytes: bytes(model.size_vram),
      remoteReferenceDetected: Boolean(model.remote_host || model.remote_model) || /-cloud(?::[^:]*)?$/.test(name) };
  });
}

/** Host RAM is diagnostic only, not Windows commit/cgroup or model admission evidence. */
export async function collectCodexFreePreflight(options = {}) {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const platform = options.platform ?? nativePlatform();
  const blockers = [], warnings = ['HOST_RAM_IS_NOT_RUNTIME_ADMISSION', 'INFERENCE_AND_REVIEW_NOT_RUN'];
  let memory = { status: 'UNKNOWN', scope: 'HOST_OS_ONLY', availableBytes: null, totalBytes: null };
  try {
    const sample = (options.readMemory ?? (() => ({ availableBytes: freemem(), totalBytes: totalmem() })))();
    if (sample && Number.isSafeInteger(sample.availableBytes) && Number.isSafeInteger(sample.totalBytes)
      && sample.totalBytes > 0 && sample.availableBytes >= 0 && sample.availableBytes <= sample.totalBytes) {
      memory = { ...memory, status: 'OBSERVED', availableBytes: sample.availableBytes, totalBytes: sample.totalBytes };
    }
  } catch { /* Never serialize native error messages or pretend missing data is zero. */ }
  if (memory.status === 'UNKNOWN') blockers.push('MEMORY_MEASUREMENT_UNAVAILABLE');
  else if (memory.availableBytes === 0) blockers.push('NO_AVAILABLE_HOST_MEMORY');
  const readInventory = options.readInventory ?? readOllamaInventory;
  const inventory = async path => {
    try { return { status: 'OBSERVED', reason: null, models: normalizeModels(await readInventory(path)) }; }
    catch (error) { return { status: 'UNAVAILABLE',
      reason: REASONS.has(error?.diagnosticReason) ? error.diagnosticReason : 'REQUEST_FAILED', models: [] }; }
  };
  const [installed, running] = await Promise.all([inventory('/api/tags'), inventory('/api/ps')]);
  if (installed.status !== 'OBSERVED') blockers.push('INSTALLED_MODEL_INVENTORY_UNAVAILABLE');
  else if (!installed.models.length) blockers.push('NO_INSTALLED_MODELS');
  if (running.status !== 'OBSERVED') blockers.push('RUNNING_MODEL_INVENTORY_UNAVAILABLE');
  const allModels = [...installed.models, ...running.models];
  if (allModels.some(model => !model.digest)) warnings.push('MODEL_DIGEST_UNAVAILABLE');
  if (allModels.some(model => model.remoteReferenceDetected)) warnings.push('REMOTE_MODEL_REFERENCES_PRESENT');
  return { schemaVersion: 1, stage: 'READ_ONLY_PREFLIGHT', observationOnly: true,
    checkedAt, platform, diagnosticStatus: blockers.length ? 'INCOMPLETE' : 'OBSERVED',
    memory, ollama: { installed, running }, blockers, warnings,
    acceptance: { codeGenerationExecuted: false, independentReviewExecuted: false,
      runtimeAdmission: 'NOT_EVALUATED', mergeAuthorized: false, endToEndVerified: false } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error('This read-only diagnostic takes no arguments.');
    process.exitCode = 64;
  } else {
    try {
      const report = await collectCodexFreePreflight();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.diagnosticStatus === 'OBSERVED' ? 0 : 2;
    } catch {
      console.error('READ_ONLY_PREFLIGHT_FAILED');
      process.exitCode = 2;
    }
  }
}
