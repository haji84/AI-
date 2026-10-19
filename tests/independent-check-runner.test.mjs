import process from "node:process";
import assert from "node:assert/strict";
import test from "node:test";
import { runIndependentVerifier, validateVerifierRunRequest, verifierCommand } from "../scripts/jarvis-independent-check-runner.mjs";

const request = () => ({
  goalId:"g",jobId:"j",changeSetId:"c",builderId:"local-ollama-builder",
  verifierId:"zbook-separate-verifier",baseRevision:"a".repeat(40),
  sourceRevision:"b".repeat(64),artifactDigest:"c".repeat(64),
  targetPath:"tests/fixtures/impl.py",
  allowedUntracked:["tests/fixtures/test.py","tests/fixtures/impl.py"],
  requiredChecks:["lint","typecheck","unit","integration","security","build"],
  candidateWorkspace:"/tmp/owner-candidate",
  verifierWorkspace:"/tmp/independent-verifier",
  privateKeyFile:"/tmp/signing-only/verifier.key",
  receiptFile:"/tmp/signing-only/receipt.json",
});
test("independent runner fixes executable to policy-owned check table",()=>{
  assert.deepEqual(verifierCommand("lint"),["pnpm",["lint"]]);
  assert.deepEqual(verifierCommand("typecheck"),["pnpm",["exec","tsc","--noEmit"]]);
  assert.deepEqual(verifierCommand("unit"),["pnpm",["test"]]);
  assert.deepEqual(verifierCommand("security"),["pnpm",["test:p8-security"]]);
  assert.deepEqual(verifierCommand("integration"),["pnpm",["test"]]);
  assert.deepEqual(verifierCommand("build"),["pnpm",["build"]]);
  assert.throws(()=>verifierCommand("postinstall"),/UNSUPPORTED/);
  assert.throws(()=>verifierCommand("rm -rf ."),/UNSUPPORTED/);
});
test("reject caller command injection, path escapes, duplicate check or fake scope",()=>{
  const p=request();
  assert.equal(validateVerifierRunRequest(p),p);
  assert.throws(()=>validateVerifierRunRequest({...p,requiredChecks:["lint","lint"]}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,requiredChecks:["lint","deploy"]}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,allowedUntracked:["../secrets"]}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,allowedUntracked:["tests/fixtures/test.py"]}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,verifierId:p.builderId}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,baseRevision:"123"}),/NOT_BOUNDED/);
  assert.throws(()=>validateVerifierRunRequest({...p,sourceRevision:"9"}),/NOT_BOUNDED/);
});
test("no privileged signer may run without separate-principal and offline image setup",async()=>{
  const a=process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;
  const b=process.env.GORIQ_VERIFIER_CONTAINER_IMAGE;
  try {
    delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;
    delete process.env.GORIQ_VERIFIER_CONTAINER_IMAGE;
    await assert.rejects(()=>runIndependentVerifier(request()),/SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED/);
    process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED="1";
    await assert.rejects(()=>runIndependentVerifier(request()),/TRUSTED_CONTAINER_IMAGE_REQUIRED/);
    process.env.GORIQ_VERIFIER_CONTAINER_IMAGE="not-pinned:latest";
    await assert.rejects(()=>runIndependentVerifier(request()),/TRUSTED_CONTAINER_IMAGE_REQUIRED/);
  } finally {
    if(a===undefined)delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;else process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED=a;
    if(b===undefined)delete process.env.GORIQ_VERIFIER_CONTAINER_IMAGE;else process.env.GORIQ_VERIFIER_CONTAINER_IMAGE=b;
  }
});
