#!/usr/bin/env node
/**
 * Owner-provisioned verifier-side worker. This is NOT a sandbox.
 * Run only as a different, restricted OS/VM principal in an isolated runner.
 * The private key must not be readable by the Broker, Builder or model.
 * Does not listen on a port, install packages, fetch models, commit or publish.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (cwd,...args) => execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true,timeout:8000}).trim();
const validPath = p => typeof p==="string" && /^(src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(p)
  && !p.split("/").some(x=>!x||x==="."||x==="..");
const names = ["lint","typecheck","unit","integration","security","build"];
export function verifierCommand(name) {
  // No caller-supplied shell commands or executable paths. Tools must already
  // exist in the separately provisioned, restricted verifier environment.
  switch(name) {
    case "lint": return ["pnpm",["lint"]];
    case "typecheck": return ["pnpm",["exec","tsc","--noEmit"]];
    case "unit": return ["pnpm",["test"]];
    case "integration": return ["node",["--test","tests/goal-controller-execution-bridge.test.ts","tests/goriq-self-development-runtime.test.ts"]];
    case "security": return ["pnpm",["test:p8-security"]];
    case "build": return ["pnpm",["build"]];
    default: throw Error("VERIFIER_CHECK_UNSUPPORTED");
  }
}
function canonical(payload) {
  return JSON.stringify({
    version:payload.version,verifierId:payload.verifierId,goalId:payload.goalId,
    jobId:payload.jobId,changeSetId:payload.changeSetId,builderId:payload.builderId,
    baseRevision:payload.baseRevision,sourceRevision:payload.sourceRevision,
    artifactDigest:payload.artifactDigest,issuedAt:payload.issuedAt,
    expiresAt:payload.expiresAt,checks:payload.checks.map(c=>({
      check:c.check,status:c.status,outputDigest:c.outputDigest,recordedAt:c.recordedAt,
    })),
  });
}
function externalPath(candidate,runner,path) {
  if(typeof path!=="string"||!isAbsolute(path))throw Error("VERIFIER_EXTERNAL_PATH_REQUIRED");
  const absolute=resolve(path);
  for(const root of [candidate,runner]){
    const diff=relative(root,absolute);
    if(!diff||(!isAbsolute(diff)&&diff!==".."&&!diff.startsWith(".."+sep)))throw Error("VERIFIER_KEY_OR_RECEIPT_IN_WORKSPACE");
  }
  return absolute;
}
function exactGitRoot(input) {
  if(typeof input!=="string"||!isAbsolute(input)||!existsSync(input))throw Error("VERIFIER_WORKSPACE_MISSING");
  const root=realpathSync(input);
  if(git(root,"rev-parse","--show-toplevel").replaceAll("\\","/").toLowerCase()!==root.replaceAll("\\","/").toLowerCase()
    ||!lstatSync(join(root,".git")).isFile()||git(root,"branch","--show-current")!=="")throw Error("VERIFIER_WORKSPACE_NOT_ISOLATED");
  return root;
}
export function validateVerifierRunRequest(req) {
  if(!req||typeof req!=="object"||Array.isArray(req)||
    !["goalId","jobId","changeSetId","builderId","verifierId"].every(x=>typeof req[x]==="string"&&req[x].length>0&&req[x].length<=128)||
    req.verifierId===req.builderId||
    !/^[a-f0-9]{40}$/.test(req.baseRevision??"")||
    !/^[a-f0-9]{64}$/.test(req.sourceRevision??"")||
    !/^[a-f0-9]{64}$/.test(req.artifactDigest??"")||
    !validPath(req.targetPath)||
    !Array.isArray(req.allowedUntracked)||req.allowedUntracked.length!==1||req.allowedUntracked[0]!==req.targetPath||
    !Array.isArray(req.requiredChecks)||req.requiredChecks.length<1||req.requiredChecks.length>6||
    req.requiredChecks.some(x=>!names.includes(x))||new Set(req.requiredChecks).size!==req.requiredChecks.length||
    !["candidateWorkspace","verifierWorkspace","privateKeyFile","receiptFile"].every(x=>typeof req[x]==="string"&&isAbsolute(req[x]))) {
    throw Error("VERIFIER_REQUEST_NOT_BOUNDED");
  }
  // This profile cannot attest visual/mobile/device checks; those remain pending.
  return req;
}
export function runIndependentVerifier(req) {
  validateVerifierRunRequest(req);
  if(process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED!=="1")throw Error("VERIFIER_SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED");
  const candidate=exactGitRoot(req.candidateWorkspace),runner=exactGitRoot(req.verifierWorkspace);
  if(candidate===runner)throw Error("VERIFIER_MUST_HAVE_DISTINCT_RUNNER_WORKSPACE");
  if(git(runner,"rev-parse","HEAD")!==req.baseRevision||git(runner,"status","--porcelain","-uall")!=="")
    throw Error("VERIFIER_RUNNER_NOT_CLEAN");
  const before=attestLocalCandidate({workspace:candidate,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(before.artifactDigest!==req.artifactDigest||before.candidateRevision!==req.sourceRevision)
    throw Error("VERIFIER_CANDIDATE_BINDING_MISMATCH");
  const keyFile=externalPath(candidate,runner,req.privateKeyFile);
  const receiptFile=externalPath(candidate,runner,req.receiptFile);
  if(existsSync(receiptFile))throw Error("VERIFIER_RECEIPT_MUST_BE_NEW");
  if(!existsSync(keyFile)||lstatSync(keyFile).isSymbolicLink()||!lstatSync(keyFile).isFile())
    throw Error("VERIFIER_PRIVATE_KEY_UNAVAILABLE");
  const key=createPrivateKey(readFileSync(keyFile));
  if(key.asymmetricKeyType!=="ed25519")throw Error("VERIFIER_SIGNER_NOT_ED25519");
  const target=resolve(runner,req.targetPath),parent=dirname(target);
  if(!realpathSync(parent).startsWith(runner+sep)||existsSync(target))
    throw Error("VERIFIER_TARGET_NOT_NEW");
  copyFileSync(resolve(candidate,req.targetPath),target,constants.COPYFILE_EXCL);
  const staged=attestLocalCandidate({workspace:runner,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(staged.artifactDigest!==before.artifactDigest||staged.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_STAGING_MISMATCH");
  const issuedAt=new Date().toISOString(),checks=[];
  for(const name of req.requiredChecks) {
    const [command,args]=verifierCommand(name);
    // This executes repository code. OS/VM restrictions and package network
    // isolation MUST be installed by the owner, not assumed from a JS flag.
    const output=spawnSync(command,args,{cwd:runner,encoding:"utf8",windowsHide:true,
      timeout:180000,maxBuffer:2*1024*1024,env:{
        PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
        NODE_ENV:"test",CI:"true",npm_config_offline:"true",
      }});
    const status=output.error||output.status===null?"inconclusive":output.status===0?"passed":"failed";
    const outputDigest=hash(JSON.stringify({
      command, args, exit:output.status, signal:output.signal,
      stdout:output.stdout??"", stderr:output.stderr??"",
      errorCode:output.error?.code??null,
    }));
    checks.push({check:name,status,outputDigest,recordedAt:new Date().toISOString()});
    if(status!=="passed")break;
  }
  const after=attestLocalCandidate({workspace:candidate,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(after.artifactDigest!==before.artifactDigest||after.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_CANDIDATE_CHANGED_DURING_EXECUTION");
  const expiry=new Date(Date.now()+20*60_000).toISOString();
  const payload={version:1,verifierId:req.verifierId,goalId:req.goalId,
    jobId:req.jobId,changeSetId:req.changeSetId,builderId:req.builderId,
    baseRevision:req.baseRevision,sourceRevision:req.sourceRevision,
    artifactDigest:req.artifactDigest,issuedAt,expiresAt:expiry,checks};
  const signatureBase64=sign(null,Buffer.from(canonical(payload)),key).toString("base64");
  const receipt={payload,signatureBase64};
  mkdirSync(dirname(receiptFile),{recursive:true});
  writeFileSync(receiptFile,JSON.stringify(receipt)+"\n",{flag:"wx",mode:0o600});
  return {verified:checks.length===req.requiredChecks.length&&checks.every(c=>c.status==="passed"),
    checks:checks.map(c=>({check:c.check,status:c.status,outputDigest:c.outputDigest})),
    receiptPath:receiptFile,artifactDigest:req.artifactDigest,sourceRevision:req.sourceRevision};
}
if(process.argv[1]&&basename(process.argv[1])==="jarvis-independent-check-runner.mjs"){
  try{
    if(process.argv.length!==3||!isAbsolute(process.argv[2]))throw Error("VERIFIER_MANIFEST_PATH_REQUIRED");
    const bytes=readFileSync(process.argv[2]);
    if(bytes.length>8192)throw Error("VERIFIER_MANIFEST_TOO_LARGE");
    process.stdout.write(JSON.stringify(runIndependentVerifier(JSON.parse(bytes.toString("utf8"))))+"\n");
  }catch(e){process.stderr.write("VERIFIER_STOP:"+String(e.message).slice(0,180)+"\n");process.exitCode=1;}
}
