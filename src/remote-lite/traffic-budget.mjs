import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const maxCounter = (1n << 64n) - 1n;
const policyKeys = ['periodStart', 'periodEnd', 'limitBytes', 'openingBytes'];
const sampleKeys = ['bootId', 'wallMs', 'uptimeMs', 'counters'];
const stateKeys = ['version', 'policy', ...sampleKeys, 'usedBytes', 'status'];
const fail = code => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, code, maximum = maxCounter) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,23})$/.test(value) || BigInt(value) > maximum) fail(code);
  return BigInt(value);
};
function validatePolicy(policy) {
  const code = 'TRAFFIC_POLICY_INVALID';
  if (!exactKeys(policy, policyKeys)) fail(code);
  for (const key of ['periodStart', 'periodEnd']) {
    if (typeof policy[key] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(policy[key]) || !Number.isFinite(Date.parse(policy[key])) || new Date(policy[key]).toISOString() !== policy[key].replace(/(?<!\.\d{3})Z$/, '.000Z')) fail(code);
  }
  const duration = Date.parse(policy.periodEnd) - Date.parse(policy.periodStart);
  if (duration <= 0 || duration > 32 * 86400000 || integer(policy.limitBytes, code) === 0n) fail(code);
  integer(policy.openingBytes, code);
}
function validateSample(sample) {
  const code = 'TRAFFIC_SAMPLE_INVALID';
  if (!exactKeys(sample, sampleKeys) || typeof sample.bootId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sample.bootId)) fail(code);
  if (![sample.wallMs, sample.uptimeMs].every(x => Number.isSafeInteger(x) && x >= 0)) fail(code);
  if (!sample.counters || typeof sample.counters !== 'object' || Array.isArray(sample.counters)) fail(code);
  const names = Object.keys(sample.counters).sort();
  if (!names.length || names.length > 256 || names.some(name => !/^[a-zA-Z0-9_.:-]{1,15}$/.test(name) || name === 'lo' || name === '.' || name === '..')) fail(code);
  for (const name of names) integer(sample.counters[name], code);
  return names;
}
const sum = counters => Object.values(counters).reduce((total, value) => total + BigInt(value), 0n);
function validateState(state) {
  try {
    if (!exactKeys(state, stateKeys) || state.version !== 1) fail('INVALID');
    validatePolicy(state.policy);
    validateSample(Object.fromEntries(sampleKeys.map(key => [key, state[key]])));
    const used = integer(state.usedBytes, 'INVALID', maxCounter * 257n);
    if (used !== BigInt(state.policy.openingBytes) + sum(state.counters) || state.wallMs < Date.parse(state.policy.periodStart) || state.wallMs >= Date.parse(state.policy.periodEnd)) fail('INVALID');
    if (state.status !== (used >= BigInt(state.policy.limitBytes) ? 'exhausted' : 'monitoring')) fail('INVALID');
  } catch { fail('TRAFFIC_STATE_INVALID'); }
}

/** Conservative whole-VM outbound accounting. This is not a provider billing hard cap. */
export function evaluateTrafficBudget(policy, snapshot, previous = null) {
  validatePolicy(policy);
  const names = validateSample(snapshot);
  if (snapshot.wallMs < Date.parse(policy.periodStart)) fail('TRAFFIC_PERIOD_NOT_STARTED');
  if (snapshot.wallMs >= Date.parse(policy.periodEnd)) fail('TRAFFIC_PERIOD_ENDED');
  let used = BigInt(policy.openingBytes) + sum(snapshot.counters);
  if (previous) {
    validateState(previous);
    if (policyKeys.some(key => previous.policy[key] !== policy[key])) fail('TRAFFIC_POLICY_CHANGED');
    if (previous.status === 'exhausted') fail('TRAFFIC_BUDGET_EXHAUSTED');
    if (snapshot.bootId !== previous.bootId) fail('TRAFFIC_BOOT_CHANGED');
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(previous.counters).sort())) fail('TRAFFIC_INTERFACES_CHANGED');
    const wallDelta = snapshot.wallMs - previous.wallMs;
    const uptimeDelta = snapshot.uptimeMs - previous.uptimeMs;
    if (wallDelta < 0 || uptimeDelta < 0) fail('TRAFFIC_CLOCK_INVALID');
    if (wallDelta > 15000 || uptimeDelta > 15000) fail('TRAFFIC_MEASUREMENT_GAP');
    let delta = 0n;
    for (const name of names) {
      const difference = BigInt(snapshot.counters[name]) - BigInt(previous.counters[name]);
      if (difference < 0n) fail('TRAFFIC_COUNTER_RESET');
      delta += difference;
    }
    used = BigInt(previous.usedBytes) + delta;
  }
  return { version: 1, policy: { ...policy }, ...snapshot, counters: { ...snapshot.counters }, usedBytes: String(used), status: used >= BigInt(policy.limitBytes) ? 'exhausted' : 'monitoring' };
}

export function readLinuxTrafficSnapshot() {
  if (process.platform !== 'linux') fail('TRAFFIC_LINUX_REQUIRED');
  const inventory = () => readdirSync('/sys/class/net').filter(name => name !== 'lo').sort();
  const names = inventory();
  if (names.some(name => !/^[a-zA-Z0-9_.:-]{1,15}$/.test(name) || name === '.' || name === '..')) fail('TRAFFIC_SAMPLE_INVALID');
  const counters = Object.fromEntries(names.map(name => [name, readFileSync(join('/sys/class/net', name, 'statistics/tx_bytes'), 'utf8').trim()]));
  if (JSON.stringify(names) !== JSON.stringify(inventory())) fail('TRAFFIC_INTERFACES_CHANGED');
  const snapshot = {
    bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    wallMs: Date.now(),
    uptimeMs: Math.round(Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) * 1000),
    counters
  };
  validateSample(snapshot);
  return snapshot;
}

function privatePath(path, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1)) fail('TRAFFIC_PATH_UNSAFE');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) fail('TRAFFIC_PATH_UNSAFE');
  return stat;
}
function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function readStateBytes(path) {
  const stat = privatePath(path);
  if (stat.size > 65536) fail('TRAFFIC_STATE_INVALID');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) fail('TRAFFIC_PATH_UNSAFE');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

/** A crash deliberately leaves traffic.lock. No automatic reinitialization or stale-lock removal. */
export function openTrafficBudget(directory, policy, { initialize = false } = {}) {
  validatePolicy(policy);
  if (!isAbsolute(directory)) fail('TRAFFIC_PATH_UNSAFE');
  directory = resolve(directory);
  if (initialize) mkdirSync(directory, { mode: 0o700 });
  privatePath(directory, true);
  const lockPath = join(directory, 'traffic.lock');
  const statePath = join(directory, 'traffic.json');
  const lockFd = openSync(lockPath, 'wx', 0o600);
  writeFileSync(lockFd, JSON.stringify({ pid: process.pid, instance: randomUUID() }) + '\n');
  fsyncSync(lockFd);
  syncDirectory(directory);
  let previous = null;
  let persistedBytes = null;
  let closed = false;
  try {
    if (!initialize) {
      try {
        persistedBytes = readStateBytes(statePath);
        previous = JSON.parse(persistedBytes);
        validateState(previous);
        if (policyKeys.some(key => previous.policy[key] !== policy[key])) fail('TRAFFIC_POLICY_CHANGED');
      } catch (error) {
        if (/^TRAFFIC_/.test(error.message)) throw error;
        fail('TRAFFIC_STATE_INVALID');
      }
    }
  } catch (error) {
    closeSync(lockFd); // Keep lock as evidence of a failed open, never grant an empty budget.
    throw error;
  }
  return {
    observe(snapshot) {
      if (closed) fail('TRAFFIC_METER_CLOSED');
      if (persistedBytes !== null) {
        try {
          if (readStateBytes(statePath) !== persistedBytes) fail('TRAFFIC_STATE_CHANGED');
        } catch { fail('TRAFFIC_STATE_CHANGED'); }
      } else {
        try { lstatSync(statePath); fail('TRAFFIC_STATE_CHANGED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const next = evaluateTrafficBudget(policy, snapshot, previous);
      const nextBytes = JSON.stringify(next) + '\n';
      const temporary = join(directory, `traffic-${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, nextBytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, statePath);
      syncDirectory(directory);
      previous = next;
      persistedBytes = nextBytes;
      return JSON.parse(JSON.stringify(next));
    },
    close() {
      if (closed) return;
      const ours = fstatSync(lockFd);
      const current = privatePath(lockPath);
      if (ours.ino !== current.ino || ours.dev !== current.dev) fail('TRAFFIC_LOCK_CHANGED');
      closeSync(lockFd);
      closed = true;
      unlinkSync(lockPath);
      syncDirectory(directory);
    }
  };
}
