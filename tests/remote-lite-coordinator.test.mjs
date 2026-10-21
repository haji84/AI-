import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ManualRemoteCoordinator } from '../src/remote-lite/manual-coordinator.mjs';
import { RemoteLitePairingRegistry } from '../src/remote-lite/device-pairing.mjs';

const auth=(ownerId='alice')=>({ownerId,authorization:'logged-in:'+ownerId});
function harness() {
  let t=1000000;
  const c=new ManualRemoteCoordinator({now:()=>t,authorizeOwner:({ownerId,authorization})=>authorization==='logged-in:'+ownerId});
  const enroll=(ownerId='alice',deviceId='win-alice')=>{
    const keys=generateKeyPairSync('ed25519'),inv=c.issueInvite(auth(ownerId));
    const req=c.proposeDevice({inviteCode:inv.inviteCode,deviceId,publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'})});
    const signed=sign(null,Buffer.from(RemoteLitePairingRegistry.enrollmentMessage({...req,deviceId})),keys.privateKey).toString('base64');
    c.proveDeviceEnrollment({requestId:req.requestId,signature:signed});
    c.approveDevice({...auth(ownerId),requestId:req.requestId,expectedFingerprint:req.fingerprint});
    return {ownerId,deviceId,keys,req};
  };
  const proof=(d,sessionId,operation,payloadHash='')=>{
    const challenge=c.challengeDevice({deviceId:d.deviceId,operation,sessionId,payloadHash});
    const signed=sign(null,Buffer.from(RemoteLitePairingRegistry.deviceMessage({...challenge,deviceId:d.deviceId,operation,sessionId,payloadHash})),d.keys.privateKey).toString('base64');
    return {...challenge,deviceId:d.deviceId,operation,sessionId,payloadHash,signature:signed};
  };
  return {c,enroll,proof,advance:n=>{t+=n;}};
}

test('local pairing -> device-accepted session -> WebRTC signaling -> manual input -> disconnect',()=>{
  const {c,enroll,proof}=harness(),d=enroll(),s=c.startSession({...auth(),deviceId:d.deviceId});
  assert.equal(s.status,'pending');
  assert.throws(()=>c.manualInput({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken,sequence:1,command:{action:'tap',x:0.5,y:0.5}}),/SESSION_NOT_ACTIVE/);
  c.acceptSession({sessionId:s.sessionId,deviceId:d.deviceId,proof:proof(d,s.sessionId,'session-accept')});
  assert.equal(c.deviceStatus({sessionId:s.sessionId,deviceId:d.deviceId,
    proof:proof(d,s.sessionId,'session-status')}).status,'active');
  const offer={type:'offer',sdp:'v=0\r\n'};
  c.viewerSignal({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken,signal:offer});
  assert.deepEqual(c.receiveSignalsForDevice({sessionId:s.sessionId,deviceId:d.deviceId,proof:proof(d,s.sessionId,'signal-receive')}),[offer]);
  const answer={type:'answer',sdp:'v=0\r\n'};
  const payloadHash=createHash('sha256').update(JSON.stringify(answer)).digest('hex');
  c.deviceSignal({sessionId:s.sessionId,deviceId:d.deviceId,signal:answer,proof:proof(d,s.sessionId,'signal-send',payloadHash)});
  assert.deepEqual(c.receiveSignalsForViewer({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken}),[answer]);
  assert.deepEqual(c.manualInput({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken,sequence:1,command:{action:'tap',x:0.5,y:0.5}}).command,{action:'tap',x:0.5,y:0.5});
  assert.equal(c.viewerStatus({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken}).status,'active');
  assert.equal(c.endSession({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken}).status,'closed');
  assert.throws(()=>c.deviceStatus({sessionId:s.sessionId,deviceId:d.deviceId,
    proof:proof(d,s.sessionId,'session-status')}),/SESSION_NOT_FOUND_OR_EXPIRED/);
  assert.throws(()=>c.viewerStatus({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken}),/SESSION_NOT_FOUND_OR_EXPIRED/);
});

test('cross-owner session and forged device approval are rejected',()=>{
  const {c,enroll,proof}=harness(),a=enroll('alice','android-a'),b=enroll('bob','android-b');
  const s=c.startSession({...auth('alice'),deviceId:a.deviceId});
  assert.throws(()=>c.startSession({...auth('bob'),deviceId:a.deviceId}),/DEVICE_NOT_OWNED/);
  assert.throws(()=>c.startSession({ownerId:'alice',authorization:'none',deviceId:a.deviceId}),/OWNER_NOT_AUTHORIZED/);
  assert.throws(()=>c.acceptSession({sessionId:s.sessionId,deviceId:a.deviceId,proof:{deviceId:a.deviceId}}),/DEVICE_PROOF_REQUIRED/);
  const ch=c.challengeDevice({deviceId:a.deviceId,operation:'session-accept',sessionId:s.sessionId});
  const forged=sign(null,Buffer.from(RemoteLitePairingRegistry.deviceMessage({...ch,deviceId:a.deviceId,operation:'session-accept',sessionId:s.sessionId})),b.keys.privateKey).toString('base64');
  assert.throws(()=>c.acceptSession({sessionId:s.sessionId,deviceId:a.deviceId,proof:{...ch,deviceId:a.deviceId,operation:'session-accept',sessionId:s.sessionId,signature:forged}}),/DEVICE_PROOF_INVALID/);
  assert.doesNotThrow(()=>c.acceptSession({sessionId:s.sessionId,deviceId:a.deviceId,proof:proof(a,s.sessionId,'session-accept')}));
});

test('signed device answer cannot be swapped or replayed',()=>{
  const {c,enroll,proof}=harness(),d=enroll(),s=c.startSession({...auth(),deviceId:d.deviceId});
  c.acceptSession({sessionId:s.sessionId,deviceId:d.deviceId,proof:proof(d,s.sessionId,'session-accept')});
  const answer={type:'answer',sdp:'v=0\r\n'};
  const h=createHash('sha256').update(JSON.stringify(answer)).digest('hex');
  const p=proof(d,s.sessionId,'signal-send',h);
  assert.throws(()=>c.deviceSignal({sessionId:s.sessionId,deviceId:d.deviceId,proof:p,signal:{type:'answer',sdp:'v=0\r\na=changed'}}),/SIGNAL_BINDING_INVALID/);
  assert.doesNotThrow(()=>c.deviceSignal({sessionId:s.sessionId,deviceId:d.deviceId,proof:p,signal:answer}));
  assert.throws(()=>c.deviceSignal({sessionId:s.sessionId,deviceId:d.deviceId,proof:p,signal:answer}),/CHALLENGE_NOT_FOUND_OR_MISMATCH/);
});

test('owner revocation disables existing control and new sessions',()=>{
  const {c,enroll,proof}=harness(),d=enroll(),s=c.startSession({...auth(),deviceId:d.deviceId});
  c.acceptSession({sessionId:s.sessionId,deviceId:d.deviceId,proof:proof(d,s.sessionId,'session-accept')});
  assert.equal(c.revokeDevice({...auth(),deviceId:d.deviceId}).status,'revoked');
  assert.throws(()=>c.manualInput({...auth(),sessionId:s.sessionId,viewerToken:s.viewerToken,sequence:1,command:{action:'tap',x:0.5,y:0.5}}),/SESSION_NOT_FOUND_OR_EXPIRED/);
  assert.throws(()=>c.startSession({...auth(),deviceId:d.deviceId}),/DEVICE_NOT_OWNED/);
  assert.throws(()=>c.challengeDevice({deviceId:d.deviceId,operation:'signal-receive',sessionId:s.sessionId}),/DEVICE_UNAVAILABLE/);
  const r=enroll('alice',d.deviceId);
  assert.equal(c.startSession({...auth(),deviceId:r.deviceId}).status,'pending');
});

test('unrelated or inactive sessions cannot consume device challenge capacity',()=>{
  const {c,enroll,proof}=harness(),a=enroll('alice','android-a'),b=enroll('bob','android-b');
  const s=c.startSession({...auth('alice'),deviceId:a.deviceId});
  for(let i=0;i<201;i++) {
    assert.throws(()=>c.challengeDevice({deviceId:a.deviceId,operation:'session-status',sessionId:'fake-'+i}),/SESSION_NOT_FOUND_OR_EXPIRED/);
  }
  assert.throws(()=>c.challengeDevice({deviceId:b.deviceId,operation:'session-accept',sessionId:s.sessionId}),/DEVICE_NOT_AUTHORIZED/);
  assert.throws(()=>c.challengeDevice({deviceId:a.deviceId,operation:'session-status',sessionId:s.sessionId}),/SESSION_NOT_ACTIVE/);
  c.acceptSession({sessionId:s.sessionId,deviceId:a.deviceId,proof:proof(a,s.sessionId,'session-accept')});
  assert.doesNotThrow(()=>c.challengeDevice({deviceId:a.deviceId,operation:'session-status',sessionId:s.sessionId}));
});

test('every viewer operation checks that owner authentication is still valid',()=>{
  let active=true;
  const c=new ManualRemoteCoordinator({authorizeOwner:({ownerId,authorization})=>active&&ownerId==='alice'&&authorization==='valid'});
  const k=generateKeyPairSync('ed25519'),invite=c.issueInvite({ownerId:'alice',authorization:'valid'});
  const req=c.proposeDevice({inviteCode:invite.inviteCode,deviceId:'android',publicKeyPem:k.publicKey.export({type:'spki',format:'pem'})});
  c.proveDeviceEnrollment({requestId:req.requestId,signature:sign(null,Buffer.from(RemoteLitePairingRegistry.enrollmentMessage({...req,deviceId:'android'})),k.privateKey).toString('base64')});
  c.approveDevice({ownerId:'alice',authorization:'valid',requestId:req.requestId,expectedFingerprint:req.fingerprint});
  const s=c.startSession({ownerId:'alice',authorization:'valid',deviceId:'android'});
  active=false;
  assert.throws(()=>c.viewerSignal({ownerId:'alice',authorization:'valid',sessionId:s.sessionId,viewerToken:s.viewerToken,signal:{type:'offer',sdp:'v=0\r\n'}}),/OWNER_NOT_AUTHORIZED/);
  assert.throws(()=>c.manualInput({ownerId:'alice',authorization:'valid',sessionId:s.sessionId,viewerToken:s.viewerToken,sequence:1,command:{action:'tap',x:0.1,y:0.1}}),/OWNER_NOT_AUTHORIZED/);
});
