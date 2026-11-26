import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import * as runner from "../scripts/jarvis-independent-check-runner.mjs";

// Public RFC8032 test vector 1, never a credential or trusted verifier identity.
// Construct this known-insecure fixture; do not generate another signing key.
const fixtureKey=createPrivateKey({key:Buffer.from("302e020100300506032b657004220420"+
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60","hex"),format:"der",type:"pkcs8"});
const fixturePublicKey=createPublicKey(fixtureKey).export({format:"pem",type:"spki"}).toString();
// P-256 generator point, public and deliberately the wrong algorithm.
const otherAlgorithm=createPublicKey({key:Buffer.from("3059301306072a8648ce3d020106082a8648ce3d03010703420004"+
  "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"+
  "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5","hex"),format:"der",type:"spki"}).export({format:"pem",type:"spki"}).toString();
const req=()=>({goalId:"g",jobId:"j",changeSetId:"c",builderId:"builder",verifierId:"independent-signer",
  baseRevision:"a".repeat(40),sourceRevision:"b".repeat(64),artifactDigest:"c".repeat(64),
  targetPath:"src/new.ts",allowedUntracked:["src/new.ts"],requiredChecks:["lint","typecheck","unit","integration","security","build"],
  candidateWorkspace:"/tmp/candidate",verifierWorkspace:"/tmp/verifier",receiptFile:"/tmp/receipts/result.json"});

test("host-selected external signer mode requires no host private path and all six checks",()=>{
  const request=req(); assert.equal(runner.validateVerifierRunRequest(request,{externalSigner:true}),request);
  assert.throws(()=>runner.validateVerifierRunRequest(request),/NOT_BOUNDED/);
  assert.throws(()=>runner.validateVerifierRunRequest({...request,privateKeyFile:"/tmp/key"},{externalSigner:true}),/NOT_BOUNDED/);
  assert.throws(()=>runner.validateVerifierRunRequest({...request,requiredChecks:["unit"]},{externalSigner:true}),/NOT_BOUNDED/);
  assert.throws(()=>runner.validateVerifierRunRequest({...request,signerTransport:{publicKeyPem:fixturePublicKey}},{externalSigner:true}),/NOT_BOUNDED/);
});

test("trusted transport verifies the exact bounded payload with the pinned public key",async()=>{
  const payload=Buffer.from('{"goalId":"g","sourceRevision":"bound-source"}'); let calls=0;
  const transport=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,async sign(bytes){
    calls++; return sign(null,bytes,fixtureKey).toString("base64");
  }});
  const signature=await transport(payload);
  assert.equal(calls,1); assert.equal(signature.length,88);
  assert.equal(verify(null,payload,fixturePublicKey,Buffer.from(signature,"base64")),true);
});

test("transport rejects invalid key types and unbounded inputs before invoking a signer",async()=>{
  let calls=0; const signPayload=async()=>{calls++; return "A".repeat(86)+"==";};
  for(const options of [null,{}, {publicKeyPem:"invalid",sign:signPayload},{publicKeyPem:otherAlgorithm,sign:signPayload},
    {publicKeyPem:fixturePublicKey,sign:"run command"},{publicKeyPem:fixturePublicKey,sign:signPayload,command:"unsafe"}]) {
    assert.throws(()=>runner.createTrustedVerifierSigner(options),/SIGNER_TRANSPORT_INVALID/);
  }
  const transport=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,sign:signPayload});
  await assert.rejects(()=>transport(Buffer.alloc(0)),/PAYLOAD_INVALID/);
  await assert.rejects(()=>transport(Buffer.alloc(24577)),/PAYLOAD_INVALID/);
  await assert.rejects(()=>transport("string instead of canonical bytes"),/PAYLOAD_INVALID/);
  assert.equal(calls,0);
});

test("transport refuses wrong or mutated signatures and never exposes callback errors",async()=>{
  const payload=Buffer.from("exact canonical bytes");
  for(const response of ["", "A".repeat(86)+"==", "X".repeat(10000), {}, null]) {
    const transport=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,sign:async()=>response});
    await assert.rejects(()=>transport(payload),/SIGNATURE_INVALID/);
  }
  const mutated=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,async sign(bytes){
    bytes[0]=0; return sign(null,bytes,fixtureKey).toString("base64");
  }});
  await assert.rejects(()=>mutated(payload),/SIGNATURE_INVALID/);
  assert.equal(payload.toString(),"exact canonical bytes");
  const failed=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,sign:async()=>{throw Error("private callback detail");}});
  await assert.rejects(()=>failed(payload),error=>error.message==="VERIFIER_SIGNER_TRANSPORT_FAILED");
});

test("untrusted request fields cannot select a transport or bypass the current isolation gate",async()=>{
  let calls=0; const request=req(), options={signerTransport:{publicKeyPem:fixturePublicKey,sign:async bytes=>{calls++;return sign(null,bytes,fixtureKey).toString("base64");}}};
  await assert.rejects(()=>runner.runIndependentVerifier({...request,signerTransport:{}},options),/NOT_BOUNDED/);
  const prior=process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED; delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;
  try {await assert.rejects(()=>runner.runIndependentVerifier(request,options),/SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED/);}
  finally {if(prior===undefined)delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;else process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED=prior;}
  assert.equal(calls,0);
});

test("trusted signer deadline refuses an unresponsive transport without a signature",async()=>{
  const transport=runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,timeoutMs:5,sign:()=>new Promise(()=>{})});
  await assert.rejects(()=>transport(Buffer.from("canonical bytes")),/TRANSPORT_TIMEOUT/);
  assert.throws(()=>runner.createTrustedVerifierSigner({publicKeyPem:fixturePublicKey,timeoutMs:15001,sign:async()=>""}),/TRANSPORT_INVALID/);
});

test("public-key pinning rejects private PEM material instead of deriving its public part",()=>{
  const privateFixture=fixtureKey.export({format:"pem",type:"pkcs8"}).toString();
  assert.throws(()=>runner.createTrustedVerifierSigner({publicKeyPem:privateFixture,sign:async()=>""}),/TRANSPORT_INVALID/);
});
