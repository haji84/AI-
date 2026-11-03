import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { sanitizeJarvisAndroidNodeContract } from '../src/jarvis/fleet-manager.ts';

const exec = promisify(execFile);
const fingerprint = value => createHash('sha256').update(String(value)).digest('hex');
const isNubia = value => /(?:^|\s)A403ZT(?:$|\s)|nubia/i.test(String(value ?? ''));

// Speak only to the existing server: never invoke adb CLI, start a daemon or pair.
export function readExistingAdb(service, serial = null, port = 5037) {
  const fixed = ['host:devices-l','shell:getprop ro.product.model',
    'shell:dumpsys package ai.jarvis.worker','shell:pm path ai.jarvis.worker'];
  const digestRead = /^shell:sha256sum '\/data\/app\/[A-Za-z0-9_./=+~-]+\/base\.apk'$/.test(service);
  const devpath = serial && service === 'get-devpath';
  if ((!fixed.includes(service) && !digestRead && !devpath) ||
      (serial !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(serial))) {
    return Promise.reject(new Error('read-only ADB service denied'));
  }
  if ((service.startsWith('shell:') || devpath) && !serial) return Promise.reject(new Error('target required'));
  return new Promise((accept,reject) => {
    const socket = createConnection({host:'127.0.0.1',port});
    let buffer = Buffer.alloc(0), stage = serial && !devpath ? 'transport' : 'service';
    let expected = null, settled = false;
    const finish = (error,value) => {
      if (settled) return;
      settled = true; socket.destroy();
      if (error) reject(new Error('existing ADB read unavailable')); else accept(value);
    };
    const send = command => {
      const bytes = Buffer.from(command);
      socket.write(Buffer.concat([Buffer.from(bytes.length.toString(16).padStart(4,'0')),bytes]));
    };
    const command = devpath ? `host-serial:${serial}:get-devpath` : service;
    socket.setTimeout(10_000);
    socket.once('connect',() => send(stage === 'transport' ? `host:transport:${serial}` : command));
    socket.on('data',chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      if (buffer.length > 1024*1024) return finish(true);
      while (!settled) {
        if (stage === 'transport' || stage === 'service') {
          if (buffer.length < 4) return;
          const status = buffer.subarray(0,4).toString(); buffer = buffer.subarray(4);
          if (status !== 'OKAY') return finish(true);
          if (stage === 'transport') { stage = 'service'; send(command); }
          else stage = service.startsWith('shell:') ? 'stream' : 'length';
        } else if (stage === 'length') {
          if (buffer.length < 4) return;
          const length = buffer.subarray(0,4).toString(); buffer = buffer.subarray(4);
          if (!/^[a-f0-9]{4}$/i.test(length)) return finish(true);
          expected = Number.parseInt(length,16); stage = 'payload';
        } else if (stage === 'payload') {
          if (buffer.length < expected) return;
          return finish(false,buffer.subarray(0,expected).toString());
        } else return;
      }
    });
    socket.once('end',() => stage === 'stream' ? finish(false,buffer.toString()) : finish(true));
    socket.once('error',() => finish(true));
    socket.once('timeout',() => finish(true));
  });
}

export function selectNubia(devices, allowed) {
  if (!allowed.length) throw new Error('existing serial allowlist unavailable');
  const matches = devices.filter(d => allowed.includes(d.serial) && d.state === 'device' &&
    String(d.transport ?? '').startsWith('usb:') && isNubia(d.model));
  if (matches.length !== 1) throw new Error('expected exactly one authorized connected Nubia');
  return matches[0];
}

export function summarizeNode(fleet, now = new Date()) {
  const nodes = fleet.filter(n => n?.kind === 'android' && isNubia(n.label));
  if (nodes.length !== 1) return {registered:false, reason:'unique_nubia_registry_record_unavailable', physicalAcceptance:'BLOCKED'};
  const node = nodes[0];
  const age = now.getTime() - Date.parse(node.lastSeenAt);
  const contract = sanitizeJarvisAndroidNodeContract(node.nodeContract, now);
  return {
    registered:true, nodeFingerprint:fingerprint(node.id),
    fresh:Number.isFinite(age) && age >= 0 && age <= 60_000,
    contractValid:Boolean(contract),
    offlineQueue:contract?.persistence.offlineQueue ?? null,
    checkpointResume:contract?.persistence.checkpointResume ?? null,
    sideEffectingFencing:contract?.migration.sideEffectingFencing ?? null,
    physicalAcceptance:'BLOCKED',
  };
}

export async function collectPreflight(output) {
  const evidence = {schemaVersion:1, goalIssue:1650, checkedAt:new Date().toISOString(),
    sourceRevision:null, hostPlatform:process.platform, readOnly:true, physicalAcceptance:'BLOCKED'};
  let stage = 'source-revision';
  try {
    const revision = (await exec('git',['rev-parse','HEAD'],{timeout:5000})).stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('invalid source revision');
    evidence.sourceRevision = revision;
    stage = 'existing-serial-allowlist';
    const allowed = (process.env.JARVIS_REMOTE_ALLOWED_SERIALS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.length) throw new Error('allowlist unavailable');
    stage = 'adb-connection';
    const lines = (await readExistingAdb('host:devices-l')).split(/\r?\n/);
    const devices = [];
    for (const line of lines) {
      const [serial,state] = line.trim().split(/\s+/);
      if (!allowed.includes(serial) || state !== 'device') continue;
      const transport = (await readExistingAdb('get-devpath',serial)).trim();
      if (!transport.startsWith('usb:')) continue;
      const model = (await readExistingAdb('shell:getprop ro.product.model',serial)).trim();
      devices.push({serial,state,model,transport});
    }
    const target = selectNubia(devices,allowed);
    evidence.deviceFingerprint = fingerprint(target.serial);
    evidence.authorizedNubiaConnected = true;
    stage = 'installed-package';
    const pkg = await readExistingAdb('shell:dumpsys package ai.jarvis.worker',target.serial);
    evidence.installedVersionCode = Number(pkg.match(/\bversionCode=(\d+)/)?.[1]) || null;
    evidence.installedVersionName = pkg.match(/\bversionName=([\d.]+)/)?.[1] ?? null;
    const paths = await readExistingAdb('shell:pm path ai.jarvis.worker',target.serial);
    const apk = paths.split(/\r?\n/).find(p => p.endsWith('/base.apk'))?.replace(/^package:/,'');
    if (apk && /^\/data\/app\/[A-Za-z0-9_./=+~-]+\/base\.apk$/.test(apk)) {
      const digest = (await readExistingAdb(`shell:sha256sum '${apk}'`,target.serial)).match(/^([a-f0-9]{64})\s/)?.[1];
      evidence.installedApkSha256 = digest ?? null;
    } else evidence.installedApkSha256 = null;
    stage = 'existing-local-broker';
    if (!process.env.JARVIS_OWNER_TOKEN) throw new Error('existing owner credential unavailable');
    const response = await fetch('http://127.0.0.1:8787/api/jarvis/admin/state',{
      headers:{Authorization:`Bearer ${process.env.JARVIS_OWNER_TOKEN}`},signal:AbortSignal.timeout(5000),redirect:'error'});
    if (!response.ok) throw new Error('broker unavailable');
    const state = await response.json();
    evidence.registry = summarizeNode(Array.isArray(state.fleet) ? state.fleet : []);
    evidence.preflightComplete = true;
    evidence.reason = 'read_only_snapshot_only_no_stage_c_acceptance';
  } catch {
    evidence.preflightComplete = false;
    evidence.reason = `preflight_blocked:${stage}`;
  }
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await collectPreflight(process.argv[2] || '.gai-results/stage-c/preflight.json');
  if (!result.preflightComplete) process.exitCode = 1;
}
