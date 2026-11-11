#!/usr/bin/env node
import { Buffer } from "node:buffer";
/**
 * Owner-provisioned verifier-side worker. This is NOT a sandbox.
 * Run only as an owner-provisioned, restricted verifier principal with a
 * locally available digest-pinned no-network container runtime.
 * The private key must not be readable by the Broker, Builder or model.
 * Does not listen on a port, install packages, fetch models, commit or publish.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { clearTimeout, setTimeout } from "node:timers";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { attestLocalCandidate, validateTrackedEditsManifest } from "./jarvis-independent-artifact-attestation.mjs";
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
    // Explicit supported Next production bundler: the immutable image-owned
    // dependency link lies outside Turbopack's inferred project root. Never
    // widen that root, rewrite source config or silently fall back on failure.
    case "build": return ["pnpm",["build","--webpack"]];
    default: throw Error("VERIFIER_CHECK_UNSUPPORTED");
  }
}
export function verifierCheckTimeoutMs(name) {
  verifierCommand(name); // the same fixed enum; no request/environment override
  return name === "unit" || name === "integration" ? 300000 : 180000;
}
function assertVerifierOperator() {
  if(process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED!=="1")throw Error("VERIFIER_SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED");
  if(!/^[a-z0-9][a-z0-9._/:@-]*@sha256:[0-9a-f]{64}$/.test(process.env.GORIQ_VERIFIER_CONTAINER_IMAGE??""))
    throw Error("VERIFIER_TRUSTED_CONTAINER_IMAGE_REQUIRED");
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
export function validateVerifierRunRequest(req, { externalSigner = false } = {}) {
  let edits;
  try { edits=validateTrackedEditsManifest(req?.trackedEdits); }
  catch { throw Error("VERIFIER_REQUEST_NOT_BOUNDED"); }
  const paths=[...(Array.isArray(req?.allowedUntracked)?req.allowedUntracked:[]),...edits.map(edit=>edit.path)];
  if(typeof externalSigner!=="boolean"||!req||typeof req!=="object"||Array.isArray(req)||Object.hasOwn(req,"signerTransport")||
    !["goalId","jobId","changeSetId","builderId","verifierId"].every(x=>typeof req[x]==="string"&&req[x].length>0&&req[x].length<=128)||
    req.verifierId===req.builderId||
    !/^[a-f0-9]{40}$/.test(req.baseRevision??"")||
    !/^[a-f0-9]{64}$/.test(req.sourceRevision??"")||
    !/^[a-f0-9]{64}$/.test(req.artifactDigest??"")||
    !validPath(req.targetPath)||
    !Array.isArray(req.allowedUntracked)||paths.length<1||paths.length>32||req.allowedUntracked.length>32||
    req.allowedUntracked.some(p=>!validPath(p))||new Set(req.allowedUntracked).size!==req.allowedUntracked.length||
    new Set(paths).size!==paths.length||!paths.includes(req.targetPath)||
    !Array.isArray(req.requiredChecks)||req.requiredChecks.length<1||req.requiredChecks.length>6||
    req.requiredChecks.some(x=>!names.includes(x))||new Set(req.requiredChecks).size!==req.requiredChecks.length||
    !["candidateWorkspace","verifierWorkspace","receiptFile",...(externalSigner?[]:["privateKeyFile"])].every(x=>typeof req[x]==="string"&&isAbsolute(req[x]))||
    (externalSigner&&Object.hasOwn(req,"privateKeyFile"))) {
    throw Error("VERIFIER_REQUEST_NOT_BOUNDED");
  }
  if((edits.length||externalSigner)&&JSON.stringify(req.requiredChecks)!==JSON.stringify(names))throw Error("VERIFIER_REQUEST_NOT_BOUNDED");
  if(req.expiresAt!==undefined){
    const deadline=typeof req.expiresAt==="string"?Date.parse(req.expiresAt):NaN;
    if(!Number.isFinite(deadline)||new Date(deadline).toISOString()!==req.expiresAt)
      throw Error("VERIFIER_REQUEST_EXPIRY_INVALID");
    if(deadline<=Date.now())throw Error("VERIFIER_REQUEST_EXPIRED");
  }
  // This profile cannot attest visual/mobile/device checks; those remain pending.
  return req;
}

/** Trusted host dependency, never deserialized from a request, Goal or env.
 * A callback is not principal evidence. Its owner must independently establish
 * key custody, isolation and bounded cleanup of the actual signing process. */
export function createTrustedVerifierSigner(transport) {
  if(!transport||typeof transport!=="object"||Array.isArray(transport)
    ||Object.keys(transport).some(key=>!["publicKeyPem","sign","timeoutMs"].includes(key))
    ||typeof transport.publicKeyPem!=="string"||!transport.publicKeyPem||Buffer.byteLength(transport.publicKeyPem)>8192
    ||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(transport.publicKeyPem)
    ||typeof transport.sign!=="function"||(transport.timeoutMs!==undefined
      &&(!Number.isInteger(transport.timeoutMs)||transport.timeoutMs<1||transport.timeoutMs>15000)))
    throw Error("VERIFIER_SIGNER_TRANSPORT_INVALID");
  let key;
  try {key=createPublicKey(transport.publicKeyPem); if(key.asymmetricKeyType!=="ed25519")throw Error();}
  catch {throw Error("VERIFIER_SIGNER_TRANSPORT_INVALID");}
  const signPayload=transport.sign,timeoutMs=transport.timeoutMs??15000;
  return async bytes=>{
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>24576)throw Error("VERIFIER_SIGNER_PAYLOAD_INVALID");
    const bound=Buffer.from(bytes); let timer,signature;
    try {
      signature=await Promise.race([
        Promise.resolve().then(()=>signPayload(Buffer.from(bound))).catch(()=>{throw Error("VERIFIER_SIGNER_TRANSPORT_FAILED");}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("VERIFIER_SIGNER_TRANSPORT_TIMEOUT")),timeoutMs);}),
      ]);
    } finally {clearTimeout(timer);}
    if(typeof signature!=="string"||signature.length!==88||!/^[A-Za-z0-9+/]{86}==$/.test(signature)
      ||!verify(null,bound,key,Buffer.from(signature,"base64")))throw Error("VERIFIER_SIGNER_SIGNATURE_INVALID");
    return signature;
  };
}

/** Byte staging only, not an isolation, executable-check, signature or release
 * verdict. Both worktrees must be host-controlled for the entire operation. */
export function stageIndependentCandidate(req) {
  const edits=validateTrackedEditsManifest(req.trackedEdits);
  if(!edits.length)throw Error("VERIFIER_TRACKED_EDITS_REQUIRED");
  const candidate=exactGitRoot(req.candidateWorkspace),runner=exactGitRoot(req.verifierWorkspace);
  if(candidate===runner||candidate.startsWith(runner+sep)||runner.startsWith(candidate+sep))
    throw Error("VERIFIER_MUST_HAVE_DISTINCT_RUNNER_WORKSPACE");
  if(git(runner,"rev-parse","HEAD")!==req.baseRevision||git(runner,"status","--porcelain","-uall")!=="")
    throw Error("VERIFIER_RUNNER_NOT_CLEAN");
  if(git(runner,"ls-files","-v","-z").split("\0").filter(Boolean).some(entry=>!entry.startsWith("H ")))
    throw Error("VERIFIER_RUNNER_INDEX_UNSAFE");
  const scope={baseRevision:req.baseRevision,targetPath:req.targetPath,allowedUntracked:req.allowedUntracked,trackedEdits:req.trackedEdits};
  const before=attestLocalCandidate({workspace:candidate,...scope});
  if(before.artifactDigest!==req.artifactDigest||before.candidateRevision!==req.sourceRevision)
    throw Error("VERIFIER_CANDIDATE_BINDING_MISMATCH");
  const paths=[...req.allowedUntracked,...edits.map(edit=>edit.path)];
  // Preflight every destination before any overwrite. Hard links and aliases
  // must not turn a fresh verifier worktree write into an external mutation.
  for(const path of paths) {
    let parent=runner;
    for(const part of path.split("/").slice(0,-1)) {
      parent=join(parent,part);
      const info=lstatSync(parent);
      if(!info.isDirectory()||info.isSymbolicLink())throw Error("VERIFIER_TARGET_UNSAFE");
    }
    const target=join(runner,path),edit=edits.find(edit=>edit.path===path);
    if(edit) {
      const info=lstatSync(target);
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>(path==="docs/jarvis-reverse-traceability.json"?1048576:131072)
        ||hash(readFileSync(target))!==edit.beforeSha256)throw Error("VERIFIER_TARGET_BASELINE_MISMATCH");
    } else if(existsSync(target))throw Error("VERIFIER_TARGET_NOT_NEW");
  }
  for(const path of paths)copyFileSync(join(candidate,path),join(runner,path),
    edits.some(edit=>edit.path===path)?0:constants.COPYFILE_EXCL);
  const staged=attestLocalCandidate({workspace:runner,...scope});
  if(staged.artifactDigest!==before.artifactDigest||staged.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_STAGING_MISMATCH");
  return staged;
}

export async function runIndependentVerifier(req, options = {}) {
  if(!options||typeof options!=="object"||Array.isArray(options)||Object.keys(options).some(key=>key!=="signerTransport"))
    throw Error("VERIFIER_SIGNER_TRANSPORT_INVALID");
  const transport=Object.hasOwn(options,"signerTransport")?createTrustedVerifierSigner(options.signerTransport):null;
  const mode={externalSigner:transport!==null};
  validateVerifierRunRequest(req,mode);
  assertVerifierOperator();
  const candidate=exactGitRoot(req.candidateWorkspace),runner=exactGitRoot(req.verifierWorkspace);
  if(candidate===runner)throw Error("VERIFIER_MUST_HAVE_DISTINCT_RUNNER_WORKSPACE");
  if(git(runner,"rev-parse","HEAD")!==req.baseRevision||git(runner,"status","--porcelain","-uall")!=="")
    throw Error("VERIFIER_RUNNER_NOT_CLEAN");
  const before=attestLocalCandidate({workspace:candidate,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked,trackedEdits:req.trackedEdits});
  if(before.artifactDigest!==req.artifactDigest||before.candidateRevision!==req.sourceRevision)
    throw Error("VERIFIER_CANDIDATE_BINDING_MISMATCH");
  const keyFile=transport?null:externalPath(candidate,runner,req.privateKeyFile);
  const receiptFile=externalPath(candidate,runner,req.receiptFile);
  if(existsSync(receiptFile))throw Error("VERIFIER_RECEIPT_MUST_BE_NEW");
  if(!transport&&(!existsSync(keyFile)||lstatSync(keyFile).isSymbolicLink()||!lstatSync(keyFile).isFile()))
    throw Error("VERIFIER_PRIVATE_KEY_UNAVAILABLE");
  validateVerifierRunRequest(req,mode);
  const key=transport?null:readPrivateKey(keyFile);
  if(!transport&&key.asymmetricKeyType!=="ed25519")throw Error("VERIFIER_SIGNER_NOT_ED25519");
  validateVerifierRunRequest(req,mode);
  if(req.trackedEdits===undefined)for(const path of req.allowedUntracked) {
    const target=resolve(runner,path),parent=dirname(target);
    if(!realpathSync(parent).startsWith(runner+sep)||existsSync(target))
      throw Error("VERIFIER_TARGET_NOT_NEW");
    copyFileSync(resolve(candidate,path),target,constants.COPYFILE_EXCL);
  }
  const staged=req.trackedEdits===undefined?attestLocalCandidate({workspace:runner,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked}):stageIndependentCandidate(req);
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
    validateVerifierRunRequest(req,mode);
    assertVerifierOperator();
    const [command,args]=verifierCommand(name);
    // Untrusted generated code must NEVER execute with this signer's host
    // identity or have access to the Ed25519 private key. A preinstalled,
    // digest-pinned, restricted no-network container is mandatory.
    const image=process.env.GORIQ_VERIFIER_CONTAINER_IMAGE??"";
    if(!/^[a-z0-9][a-z0-9._/:@-]*@sha256:[0-9a-f]{64}$/.test(image))
      throw Error("VERIFIER_TRUSTED_CONTAINER_IMAGE_REQUIRED");
    // command/args come exclusively from the code-owned enum above.
    // Host shell never interprets paths or caller-controlled instructions.
    // The helper is part of the pinned image, never the untrusted /source tree.
    // It admits only a byte-matching, already-installed offline dependency set.
    // Reserve Docker's infrastructure exit 125 for preparation failure too;
    // no unavailable dependency set may masquerade as a definitive check FAIL.
    const staticScript="node /opt/goriq-verifier/jarvis-verifier-offline-workspace.mjs || exit 125; cd /tmp/verify || exit 125; exec "+[command,...args].join(" ");
    const dockerArgs=["run","--rm","--pull=never","--network=none","--read-only",
      "--cap-drop=ALL","--security-opt=no-new-privileges","--pids-limit=128",
      "--memory=2g","--cpus=2","--user=65534:65534",
      "--tmpfs","/tmp:rw,noexec,nosuid,nodev,uid=65534,gid=65534,mode=0700,size=1536m",
      "--mount",`type=bind,source=${snapshot},target=/source,readonly`,
      "--workdir","/","--entrypoint","/bin/sh",
      image,"-ec",staticScript];
    const timeoutMs=verifierCheckTimeoutMs(name);
    const output=await runVerifierContainer(dockerArgs,{cwd:runner,
      untrustedExecutableRoots:[candidate,runner,snapshot],
      timeoutMs,maxBuffer:2*1024*1024,env:{
        PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
      }});
    // Only a closed, cleaned, normally exited command can produce PASS/FAIL.
    // Docker reserves 125/126/127 for execution failures; higher exits can
    // encode fatal signals/resource loss and stay inconclusive conservatively.
    const completed=!output.error&&output.closeObserved===true&&output.cleanup?.confirmed===true
      &&!output.signal&&Number.isInteger(output.status)&&output.status>=0&&output.status<125;
    const status=!completed?"inconclusive":output.status===0?"passed":"failed";
    const log=JSON.stringify({
      sourceRevision:before.candidateRevision,fileHashes:before.fileHashes,
      command, args, timeoutMs, executionProfile:name==="build"?"next-webpack-v1":null,
      containerImage:image, exit:output.status, signal:output.signal,
      stdout:output.stdout??"", stderr:output.stderr??"",
      errorCode:output.error?.code??null,
      runErrorCode:output.runErrorCode??null,closeObserved:output.closeObserved,cleanup:output.cleanup,
      cliTiming:output.cliTiming??null,
    })+"\n";
    const outputDigest=hash(log);
    externalPath(candidate,runner,logDirectory);
    writeFileSync(join(logDirectory,name+".json"),log,{flag:"wx",mode:0o600});
    checks.push({check:name,status,outputDigest,recordedAt:new Date().toISOString()});
    if(status==="inconclusive")break;
  }
  const after=attestLocalCandidate({workspace:candidate,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked,trackedEdits:req.trackedEdits});
  if(after.artifactDigest!==before.artifactDigest||after.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_CANDIDATE_CHANGED_DURING_EXECUTION");
  const runnerAfter=attestLocalCandidate({workspace:runner,baseRevision:req.baseRevision,
    targetPath:req.targetPath,allowedUntracked:req.allowedUntracked,trackedEdits:req.trackedEdits});
  if(runnerAfter.candidateRevision!==before.candidateRevision)
    throw Error("VERIFIER_RUNNER_CHANGED_DURING_EXECUTION");
  validateVerifierRunRequest(req,mode);
  assertVerifierOperator();
  const expiry=new Date(Math.min(Date.now()+20*60_000,
    req.expiresAt===undefined?Infinity:Date.parse(req.expiresAt))).toISOString();
  const payload={version:1,verifierId:req.verifierId,goalId:req.goalId,
    jobId:req.jobId,changeSetId:req.changeSetId,builderId:req.builderId,
    baseRevision:req.baseRevision,sourceRevision:req.sourceRevision,
    artifactDigest:req.artifactDigest,issuedAt,expiresAt:expiry,checks};
  const bytes=Buffer.from(canonical(payload));
  const signatureBase64=transport?await transport(bytes):sign(null,bytes,key).toString("base64");
  validateVerifierRunRequest(req,mode); // an asynchronous signer cannot extend expired scope
  assertVerifierOperator();
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
