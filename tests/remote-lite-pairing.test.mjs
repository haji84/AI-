import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';

const pair = () => generateKeyPairSync('ed25519');
const sig = (key, data) => sign(null, Buffer.from(data), key).toString('base64');
const pem = keys => keys.publicKey.export({type:'spki',format:'pem'});
function setup({limit=100,inviteMs=300000,proofMs=60000}={}) {
  let time=1000000;
  const r = new RemoteLitePairingRegistry({now:()=>time,limit,inviteMs,proofMs,
    authorizeOwner:({ownerId,authorization})=>authorization==='verified:'+ownerId});
  const owner=(ownerId='alice')=>({ownerId,authorization:'verified:'+ownerId});
  const enroll=(deviceId='android-a',ownerId='alice')=>{
    const keys=pair(),invite=r.issueInvite(owner(ownerId));
    const request=r.propose({inviteCode:invite.inviteCode,deviceId,publicKeyPem:pem(keys)});
    const signature=sig(keys.privateKey,RemoteLitePairingRegistry.enrollmentMessage({...request,deviceId}));
    r.prove({requestId:request.requestId,signature});
    const approved=r.approve({...owner(ownerId),requestId:request.requestId,expectedFingerprint:request.fingerprint});
    return {keys,deviceId,ownerId,request,approved};
  };
  const proof=(device,operation='session-accept',sessionId='s',payloadHash='')=>{
    const challenge=r.challengeDevice({deviceId:device.deviceId,operation,sessionId,payloadHash});
    return {...challenge,deviceId:device.deviceId,operation,sessionId,payloadHash,
      signature:sig(device.keys.privateKey,RemoteLitePairingRegistry.deviceMessage({...challenge,deviceId:device.deviceId,operation,sessionId,payloadHash}))};
  };
  return {r,owner,enroll,proof,advance:ms=>{time+=ms;}};
}

test('requires verified owner rather than a caller-provided owner ID',()=>{
  assert.throws(()=>new RemoteLitePairingRegistry(),TypeError);
  const {r}=setup();
  assert.throws(()=>r.issueInvite({ownerId:'alice',authorization:'claimed'}),/OWNER_NOT_AUTHORIZED/);
});

test('one-use invite with device key proof requires separate explicit owner fingerprint approval',()=>{
  const {r,owner}=setup(),keys=pair();
  const {inviteCode}=r.issueInvite(owner());
  const req=r.propose({inviteCode,deviceId:'android-a',publicKeyPem:pem(keys)});
  assert.match(req.fingerprint,/^[a-f0-9]{64}$/);
  assert.throws(()=>r.approve({...owner(),requestId:req.requestId,expectedFingerprint:req.fingerprint}),/PAIRING_NOT_APPROVABLE/);
  assert.throws(()=>r.propose({inviteCode,deviceId:'other',publicKeyPem:pem(keys)}),/INVITE_INVALID/);
  const signed=sig(keys.privateKey,RemoteLitePairingRegistry.enrollmentMessage({...req,deviceId:'android-a'}));
  assert.equal(r.prove({requestId:req.requestId,signature:signed}).status,'awaiting-owner-approval');
  assert.throws(()=>r.prove({requestId:req.requestId,signature:signed}),/PROOF_ALREADY_USED/);
  assert.throws(()=>r.approve({...owner('bob'),requestId:req.requestId,expectedFingerprint:req.fingerprint}),/PAIRING_NOT_APPROVABLE/);
  assert.throws(()=>r.approve({...owner(),requestId:req.requestId,expectedFingerprint:'a'.repeat(64)}),/FINGERPRINT_MISMATCH/);
  assert.equal(r.approve({...owner(),requestId:req.requestId,expectedFingerprint:req.fingerprint}).status,'registered');
});

test('a different private key cannot impersonate enrolling device',()=>{
  const {r,owner}=setup(),genuine=pair(),attacker=pair();
  const invite=r.issueInvite(owner());
  const req=r.propose({inviteCode:invite.inviteCode,deviceId:'a',publicKeyPem:pem(genuine)});
  const signed=sig(attacker.privateKey,RemoteLitePairingRegistry.enrollmentMessage({...req,deviceId:'a'}));
  assert.throws(()=>r.prove({requestId:req.requestId,signature:signed}),/DEVICE_PROOF_INVALID/);
});

test('invalid public keys or private key PEM never enroll',()=>{
  const {r,owner}=setup(),k=pair();
  const inv=r.issueInvite(owner());
  for(const pub of ['invalid',k.privateKey.export({type:'pkcs8',format:'pem'}),generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'})]){
    assert.throws(()=>r.propose({inviteCode:inv.inviteCode,deviceId:'a',publicKeyPem:pub}),/DEVICE_KEY_INVALID/);
  }
});

test('signed device challenges bind device, operation, session and reject replay',()=>{
  const {r,enroll,proof}=setup(),d=enroll();
  const p=proof(d);
  assert.throws(()=>r.verifyDevice({...p,sessionId:'other'}),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
  assert.throws(()=>r.verifyDevice(p),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
  const q=proof(d);
  assert.equal(r.verifyDevice(q).devicePrincipalId,d.request.fingerprint);
  assert.throws(()=>r.verifyDevice(q),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
});

test('signal sending requires a payload hash and its verified signature',()=>{
  const {r,enroll,proof}=setup(),d=enroll(),hash='a'.repeat(64);
  assert.throws(()=>r.challengeDevice({deviceId:d.deviceId,operation:'signal-send',sessionId:'s'}),/SIGNAL_BINDING_INVALID/);
  const p=proof(d,'signal-send','s',hash);
  assert.throws(()=>r.verifyDevice({...p,payloadHash:'b'.repeat(64)}),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
  assert.throws(()=>r.verifyDevice(p),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
  const next=proof(d,'signal-send','s',hash);
  assert.equal(r.verifyDevice(next).operation,'signal-send');
});

test('one device cannot fill the shared challenge pool for another device',()=>{
  const {r,enroll}=setup(),a=enroll('android-a'),b=enroll('android-b');
  for(let i=0;i<8;i++) assert.doesNotThrow(()=>r.challengeDevice({deviceId:a.deviceId,operation:'session-status',sessionId:'s'}));
  assert.throws(()=>r.challengeDevice({deviceId:a.deviceId,operation:'session-status',sessionId:'s'}),/CHALLENGE_DEVICE_CAPACITY_REACHED/);
  assert.doesNotThrow(()=>r.challengeDevice({deviceId:b.deviceId,operation:'session-status',sessionId:'s'}));
});

test('one owner with many devices cannot fill the shared challenge pool',()=>{
  const {r,enroll}=setup();
  const aliceA=enroll('alice-a','alice'),aliceB=enroll('alice-b','alice');
  const aliceC=enroll('alice-c','alice'),bob=enroll('bob-a','bob');
  let first;
  for(const device of [aliceA,aliceB]) {
    for(let i=0;i<8;i++) {
      const challenge=r.challengeDevice({deviceId:device.deviceId,operation:'session-status',sessionId:'s'});
      if(!first) first=challenge;
    }
  }
  assert.throws(()=>r.challengeDevice({deviceId:aliceC.deviceId,operation:'session-status',sessionId:'s'}),/CHALLENGE_OWNER_CAPACITY_REACHED/);
  assert.doesNotThrow(()=>r.challengeDevice({deviceId:bob.deviceId,operation:'session-status',sessionId:'s'}));
  const message=RemoteLitePairingRegistry.deviceMessage({...first,deviceId:aliceA.deviceId,operation:'session-status',sessionId:'s'});
  r.verifyDevice({...first,deviceId:aliceA.deviceId,operation:'session-status',sessionId:'s',signature:sig(aliceA.keys.privateKey,message)});
  assert.doesNotThrow(()=>r.challengeDevice({deviceId:aliceC.deviceId,operation:'session-status',sessionId:'s'}));
});

test('revoke disables identity, cancels challenges and blocks cross-owner revocation',()=>{
  const {r,enroll,owner,proof}=setup(),d=enroll(),p=proof(d);
  assert.throws(()=>r.revoke({...owner('bob'),deviceId:d.deviceId}),/DEVICE_NOT_FOUND/);
  assert.equal(r.revoke({...owner(),deviceId:d.deviceId}).status,'revoked');
  assert.equal(r.isAuthorizedDevice({ownerId:'alice',deviceId:d.deviceId,devicePrincipalId:d.request.fingerprint}),false);
  assert.throws(()=>r.verifyDevice(p),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
  assert.throws(()=>r.challengeDevice({deviceId:d.deviceId,operation:'reconnect',sessionId:'s'}),/DEVICE_UNAVAILABLE/);
});

test('one-time invite and pending device proof expire',()=>{
  const {r,owner,advance}=setup({inviteMs:1500,proofMs:1000});
  const initial=r.issueInvite(owner());advance(1500);
  assert.throws(()=>r.propose({inviteCode:initial.inviteCode,deviceId:'a',publicKeyPem:pem(pair())}),/INVITE_INVALID/);
  const fresh=r.issueInvite(owner()),keys=pair();
  const req=r.propose({inviteCode:fresh.inviteCode,deviceId:'a',publicKeyPem:pem(keys)});advance(1001);
  assert.throws(()=>r.prove({requestId:req.requestId,signature:sig(keys.privateKey,RemoteLitePairingRegistry.enrollmentMessage({...req,deviceId:'a'}))}),/PAIRING_EXPIRED_OR_NOT_FOUND/);
});

test('limits registered devices and rejects duplicate IDs',()=>{
  const {r,enroll}=setup({limit:2});
  enroll('android-a');
  assert.throws(()=>enroll('android-a'),/DEVICE_ALREADY_REGISTERED/);
  enroll('windows-a');
  assert.throws(()=>enroll('new'),/PAIRING_CAPACITY_REACHED/);
  assert.equal(r.ownsDevice({ownerId:'alice',deviceId:'windows-a'}),true);
  assert.equal(r.ownsDevice({ownerId:'bob',deviceId:'windows-a'}),false);
});

test('malformed signatures, unsupported operation and other-owner keys fail closed',()=>{
  const {r,enroll}=setup(),a=enroll('android-a'),b=enroll('android-b','bob');
  assert.throws(()=>r.challengeDevice({deviceId:a.deviceId,operation:'execute-code',sessionId:'s'}),/DEVICE_UNAVAILABLE/);
  const challenge=r.challengeDevice({deviceId:a.deviceId,operation:'session-accept',sessionId:'s'});
  const forged=sig(b.keys.privateKey,RemoteLitePairingRegistry.deviceMessage({...challenge,deviceId:a.deviceId,operation:'session-accept',sessionId:'s'}));
  assert.throws(()=>r.verifyDevice({...challenge,deviceId:a.deviceId,operation:'session-accept',sessionId:'s',signature:forged}),/DEVICE_PROOF_INVALID/);
  const second=r.challengeDevice({deviceId:a.deviceId,operation:'session-accept',sessionId:'s'});
  assert.throws(()=>r.verifyDevice({...second,deviceId:a.deviceId,operation:'session-accept',sessionId:'s',signature:'bad'}),/SIGNATURE_INVALID/);
});
