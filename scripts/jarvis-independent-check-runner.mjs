#!/usr/bin/env node
import { Buffer } from "node:buffer";
/**
 * Owner-provisioned verifier-side worker. This is NOT a sandbox.
 * Run only as an owner-provisioned, restricted verifier principal with a
 * locally available digest-pinned no-network container runtime.
 * The private key must not be readable by the Broker, Builder or model.
 * Does not listen on a port, install packages, fetch models, commit or publish.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";
import { safeGit } from "./jarvis-verifier-safe-git.mjs";
import { runVerifierContainer } from "./jarvis-verifier-container.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (cwd,...args) => safeGit(cwd,args);
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
    case "integration": return ["pnpm",["test"]]; // full suite includes cross-module tests; no partial subset is misrepresented
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
  // Reject ancestor aliases as well as final-component links. The signer must
  // use owner-controlled directories; these checks do not replace OS isolation.
  let cursor=absolute;
  while(true){
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw Error("VERIFIER_EXTERNAL_PATH_UNSAFE");
    const parent=dirname(cursor);
    if(parent===cursor)break;
    cursor=parent;
  }
  for(const root of [candidate,runner]){
    const diff=relative(root,absolute);
    if(!diff||(!isAbsolute(diff)&&diff!==".."&&!diff.startsWith(".."+sep)))throw Error("VERIFIER_KEY_OR_RECEIPT_IN_WORKSPACE");
  }
  return absolute;
}
function readPrivateKey(file) {
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=fstatSync(fd);
    if(!before.isFile()||before.nlink!==1||before.size<1||before.size>8192)throw Error("VERIFIER_PRIVATE_KEY_UNAVAILABLE");
    const bytes=Buffer.alloc(8193);
    let count=0,read;
    while(count<bytes.length&&(read=readSync(fd,bytes,count,bytes.length-count,null))>0)count+=read;
    const after=fstatSync(fd);
    if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error("VERIFIER_PRIVATE_KEY_CHANGED");
    return createPrivateKey(bytes.subarray(0,count));
  }finally{closeSync(fd);}
}
function exportSnapshot(runner,destination,fileHashes) {
  const declared=Object.keys(fileHashes);
  const tracked=git(runner,"ls-files","-z","--cached").split("\0").filter(Boolean);
  // The private log parent stays 0700; the bind-mounted exported subtree must
  // be readable by the container's unprivileged UID, and contains no host keys.
  mkdirSync(destination,{mode:0o755});
  chmodSync(destination,0o755); // do not let signer umask 077 break the bind mount
  const directories=new Set([destination]);
  for(const path of [...new Set([...tracked,...declared])].sort()){
    if(isAbsolute(path)||path.includes("\\")||path.split("/").some(p=>!p||p==="."||p===".."||p.toLowerCase()===".git"))
      throw Error("VERIFIER_SNAPSHOT_PATH_UNSAFE");
    let source=runner;
    for(const part of path.split("/")){
      source=join(source,part);
      if(lstatSync(source).isSymbolicLink())throw Error("VERIFIER_SNAPSHOT_LINK_UNSAFE");
    }
    if(!lstatSync(source).isFile())throw Error("VERIFIER_SNAPSHOT_FILE_UNSAFE");
    const target=join(destination,path);
    let directory=destination;
    for(const part of path.split("/").slice(0,-1)){
      directory=join(directory,part);
      if(!directories.has(directory)){
        mkdirSync(directory,{mode:0o755});
        chmodSync(directory,0o755);
        directories.add(directory);
      }
    }
    copyFileSync(source,target,constants.COPYFILE_EXCL);
    if(fileHashes[path]&&hash(readFileSync(target))!==fileHashes[path])throw Error("VERIFIER_SNAPSHOT_BINDING_MISMATCH");
    chmodSync(target,(lstatSync(source).mode&0o111)?0o555:0o444);
  }
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
    !Array.isArray(req.allowedUntracked)||req.allowedUntracked.length<1||req.allowedUntracked.length>32||
    req.allowedUntracked.some(p=>!validPath(p))||new Set(req.allowedUntracked).size!==req.allowedUntracked.length||
    !req.allowedUntracked.includes(req.targetPath)||
    !Array.isArray(req.requiredChecks)||req.requiredChecks.length<1||req.requiredChecks.length>6||
    req.requiredChecks.some(x=>!names.includes(x))||new Set(req.requiredChecks).size!==req.requiredChecks.length||
    !["candidateWorkspace","verifierWorkspace","privateKeyFile","receiptFile"].every(x=>typeof req[x]==="string"&&isAbsolute(req[x]))) {
    throw Error("VERIFIER_REQUEST_NOT_BOUNDED");
  }
  // This profile cannot attest visual/mobile/device checks; those remain pending.
  return req;
}
export async function runIndependentVerifier(req) {
  validateVerifierRunRequest(req);
  if(process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED!=="1")throw Error("VERIFIER_SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED");
  if(!/^[a-z0-9][a-z0-9._/:@-]*@sha256:[0-9a-f]{64}$/.test(process.env.GORIQ_VERIFIER_CONTAINER_IMAGE??""))
    throw Error("VERIFIER_TRUSTED_CONTAINER_IMAGE_REQUIRED");
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
  const key=readPrivateKey(keyFile);
  if(key.asymmetricKeyType!=="ed25519")throw Error("VERIFIER_SIGNER_NOT_ED25519");
  for(const path of req.allowedUntracked) {
    const target=resolve(runner,path),parent=dirname(target);
    if(!realpathSync(parent).startsWith(runner+sep)||existsSync(target))
      throw Error("VERIFIER_TARGET_NOT_NEW");
    copyFileSync(resolve(candidate,path),target,constants.COPYFILE_EXCL);
  }
  const staged=attestLocalCandidate({workspace:runner,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(staged.artifactDigest!==before.artifactDigest||staged.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_STAGING_MISMATCH");
  const logDirectory=externalPath(candidate,runner,receiptFile+".logs");
  if(/[,\r\n]/.test(logDirectory))throw Error("VERIFIER_SNAPSHOT_PATH_UNSAFE");
  mkdirSync(dirname(logDirectory),{recursive:true});
  mkdirSync(logDirectory,{mode:0o700}); // exclusive, never overwrite another run
  const snapshot=join(logDirectory,"source");
  exportSnapshot(runner,snapshot,staged.fileHashes);
  const issuedAt=new Date().toISOString(),checks=[];
  for(const name of req.requiredChecks) {
    const [command,args]=verifierCommand(name);
    // Untrusted generated code must NEVER execute with this signer's host
    // identity or have access to the Ed25519 private key. A preinstalled,
    // digest-pinned, restricted no-network container is mandatory.
    const image=process.env.GORIQ_VERIFIER_CONTAINER_IMAGE??"";
    if(!/^[a-z0-9][a-z0-9._/:@-]*@sha256:[0-9a-f]{64}$/.test(image))
      throw Error("VERIFIER_TRUSTED_CONTAINER_IMAGE_REQUIRED");
    // command/args come exclusively from the code-owned enum above.
    // Host shell never interprets paths or caller-controlled instructions.
    const staticScript="cp -a /source/. /tmp/verify && chmod -R u+rwX /tmp/verify && cd /tmp/verify && exec "+[command,...args].join(" ");
    const dockerArgs=["run","--rm","--pull=never","--network=none","--read-only",
      "--cap-drop=ALL","--security-opt=no-new-privileges","--pids-limit=128",
      "--memory=2g","--cpus=2","--user=65534:65534",
      "--tmpfs","/tmp:rw,nosuid,nodev,size=1536m",
      "--mount",`type=bind,source=${snapshot},target=/source,readonly`,
      "--workdir","/","--entrypoint","/bin/sh",
      image,"-ec",staticScript];
    const output=await runVerifierContainer(dockerArgs,{cwd:runner,
      timeoutMs:180000,maxBuffer:2*1024*1024,env:{
        PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
      }});
    const status=output.error||output.status===null?"inconclusive":output.status===0?"passed":"failed";
    const log=JSON.stringify({
      sourceRevision:before.candidateRevision,fileHashes:before.fileHashes,
      command, args, exit:output.status, signal:output.signal,
      stdout:output.stdout??"", stderr:output.stderr??"",
      errorCode:output.error?.code??null,
      runErrorCode:output.runErrorCode??null,closeObserved:output.closeObserved,cleanup:output.cleanup,
    })+"\n";
    const outputDigest=hash(log);
    externalPath(candidate,runner,logDirectory);
    writeFileSync(join(logDirectory,name+".json"),log,{flag:"wx",mode:0o600});
    checks.push({check:name,status,outputDigest,recordedAt:new Date().toISOString()});
    if(status!=="passed")break;
  }
  const after=attestLocalCandidate({workspace:candidate,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(after.artifactDigest!==before.artifactDigest||after.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_CANDIDATE_CHANGED_DURING_EXECUTION");
  const runnerAfter=attestLocalCandidate({workspace:runner,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked});
  if(runnerAfter.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_RUNNER_CHANGED_DURING_EXECUTION");
  const expiry=new Date(Date.now()+20*60_000).toISOString();
  const payload={version:1,verifierId:req.verifierId,goalId:req.goalId,
    jobId:req.jobId,changeSetId:req.changeSetId,builderId:req.builderId,
    baseRevision:req.baseRevision,sourceRevision:req.sourceRevision,
    artifactDigest:req.artifactDigest,issuedAt,expiresAt:expiry,checks};
  const signatureBase64=sign(null,Buffer.from(canonical(payload)),key).toString("base64");
  const receipt={payload,signatureBase64};
  externalPath(candidate,runner,receiptFile);
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
    process.stdout.write(JSON.stringify(await runIndependentVerifier(JSON.parse(bytes.toString("utf8"))))+"\n");
  }catch(e){process.stderr.write("VERIFIER_STOP:"+String(e.message).slice(0,180)+"\n");process.exitCode=1;}
}
