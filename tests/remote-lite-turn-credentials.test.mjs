import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { issueTurnCredentials, relayReadiness, TurnConfigError, createPortalTurnIssuer } from '../src/remote-lite/turn-credentials.mjs';

const values = {
  sharedSecret: 'a-simulated-secret-used-only-in-tests-0000000000000',
  urls: ['turn:relay.example.net:3478?transport=udp','turns:relay.example.net:5349?transport=tcp'],
  principalId: 'friend-a', sessionId: 'session-17',
  authorize: ({principalId,sessionId}) => principalId==='friend-a'&&sessionId==='session-17',
  now: () => 100000000,
};

test('TURN REST creates HMAC-SHA1 time-bound credentials without exposing shared secret',()=>{
  const result=issueTurnCredentials(values);
  const server=result.iceServers[0];
  assert.deepEqual(server.urls,values.urls);
  assert.match(server.username,/^\d+:[a-f0-9]{32}$/);
  assert.equal(server.credential,createHmac('sha1',values.sharedSecret).update(server.username).digest('base64'));
  assert.equal(result.expiresAt,100300000);
  assert.equal(JSON.stringify(result).includes(values.sharedSecret),false);
});

test('cannot issue TURN credentials without independent session authorization',()=>{
  assert.throws(()=>issueTurnCredentials({...values,authorize:()=>false}),TurnConfigError);
  assert.throws(()=>issueTurnCredentials({...values,authorize:undefined}),/TURN_NOT_AUTHORIZED/);
  assert.throws(()=>issueTurnCredentials({...values,sessionId:'session-18'}),/TURN_NOT_AUTHORIZED/);
});

test('rejects dangerous or malformed relay configurations',()=>{
  for(const url of ['http://relay.example.com','turn:user@relay.example.com','turn:relay..example.com','turn:relay.local:300000','turn:127.0.0.1#injected']){
    assert.throws(()=>issueTurnCredentials({...values,urls:[url]}),TurnConfigError);
  }
  assert.throws(()=>issueTurnCredentials({...values,sharedSecret:'short'}),/TURN_SECRET_UNAVAILABLE/);
  assert.throws(()=>issueTurnCredentials({...values,ttlSeconds:3600}),/TURN_TTL_INVALID/);
});

test('server readiness fails shut on missing cost and approval evidence',()=>{
  assert.deepEqual(relayReadiness({}),{
    ready:false,missing:['PROVIDER_APPROVAL','CREDENTIAL_APPROVAL','BILLING_HARD_CAP','RELAY_BUDGET','LIVE_HEALTH','RELAY_AUTH'],
  });
  assert.equal(relayReadiness({
    providerApproved:true,credentialsApproved:true,billingHardCapVerified:true,maxRelayGiB:1,
    deployedHealthVerified:true,authConfigured:true,
  }).ready,true);
});

test('portal adapter validates configuration before listen and requires an authenticated owner identity', () => {
  const issuer = createPortalTurnIssuer({ sharedSecret: values.sharedSecret, urls: values.urls, now: values.now });
  const result = issuer({ ownerId: 'friend-a', sessionId: 'session-17' });
  assert.equal(result.expiresAt, 100600000);
  assert.equal(JSON.stringify(result).includes(values.sharedSecret), false);
  assert.throws(() => createPortalTurnIssuer({ sharedSecret: 'short', urls: values.urls }), /TURN_SECRET_UNAVAILABLE/);
  assert.throws(() => createPortalTurnIssuer({ sharedSecret: values.sharedSecret, urls: ['turn:host:99999'] }), /TURN_URLS_INVALID/);
  assert.throws(() => issuer({ ownerId: undefined, sessionId: 'session-17' }), /TURN_PRINCIPAL_INVALID/);
});
