import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { open, lstat, mkdir, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile);
export function validateOwnerSecretApproval(value,artifacts,now=Date.now()) {
  const start=Date.parse(value?.approvedAt),end=Date.parse(value?.expiresAt);
  if(value?.version!==1 || value.issue!==1662 || value.goalIssue!==1219 || value.owner!=='haji84' ||
    value.nodeId!=='macbook' || value.platform!=='macos' || value.operation!=='initialize-missing-owner-session-secret' ||
    value.variable!=='JARVIS_OWNER_SECRET' || value.sourceBinding!=='current-main-successful-ci' ||
    !/^https:\/\/github\.com\/haji84\/AI-\/issues\/1662#issuecomment-\d+$/.test(value.evidence || '') ||
    !Number.isFinite(start) || !Number.isFinite(end) || start>now || end<=now || end<=start || end-start>86400000 ||
    !artifacts || !Object.keys(artifacts).length || !Object.values(artifacts).every(x=>/^[a-f0-9]{40}$/.test(x)) ||
    !isDeepStrictEqual(value.artifacts,artifacts))throw Error('OWNER_SECRET_APPROVAL_REJECTED');
}
export async function atomicOwnerFileExchange(a,b) {
  if(!isAbsolute(a) || !isAbsolute(b))throw Error('OWNER_SECRET_SWAP_REJECTED');
  try {await exec('/usr/bin/python3',['-I',fileURLToPath(new URL('./goriq-owner-file-swap.py',import.meta.url)),a,b],
    {timeout:10000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});}
  catch {throw Error('OWNER_SECRET_SWAP_REJECTED');}
}
async function privateWrite(path,bytes,mode=0o600) {
  const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(bytes);await f.chmod(mode);await f.sync();}finally{await f.close();}
}
async function syncDirectory(path) {
  const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await f.sync();}finally{await f.close();}
}
const equalMetadata=(a,b)=>isDeepStrictEqual(a.metadata,b.metadata);
const equalFile=(a,b)=>equalMetadata(a,b) && a.dev===b.dev && a.ino===b.ino && a.bytes.equals(b.bytes);
const lockPath=path=>join(dirname(path),'.goriq-owner-secret-initialization.lock');
export async function assertNoOwnerSecretTransaction(path) {
  try{await lstat(lockPath(path));}catch(error){if(error.code==='ENOENT')return;throw error;}
  throw Error('OWNER_SECRET_PENDING_TRANSACTION');
}
export async function initializeOwnerSecret(input,ops) {
  const checkApproval=()=>validateOwnerSecretApproval(input.approval,input.artifacts,ops.now?.() ?? Date.now());
  checkApproval();
  if(!['plan','apply'].includes(input.phase) || !isAbsolute(input.path) || !/^[a-f0-9]{40}$/.test(input.revision || ''))throw Error('OWNER_SECRET_CONTEXT_REJECTED');
  await assertNoOwnerSecretTransaction(input.path);
  const snapshot=async(path)=>{
    await ops.guard(path);const metadata=await ops.metadata(path);
    if(metadata.uid!==process.getuid() || metadata.gid!==process.getgid() || metadata.mode&0o7022 ||
      !Array.isArray(metadata.acl) || metadata.acl.length || metadata.flags!==0)throw Error('OWNER_SECRET_METADATA_REJECTED');
    const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=await f.stat();if(!stat.isFile() || stat.nlink!==1 || stat.size>1048576)throw Error('OWNER_SECRET_FILE_REJECTED');
      const bytes=await f.readFile();const after=await lstat(path);
      if(bytes.length>1048576 || after.ino!==stat.ino || after.dev!==stat.dev || !isDeepStrictEqual(metadata,await ops.metadata(path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
      return {bytes,metadata,ino:stat.ino,dev:stat.dev};
    }finally{await f.close();}
  };
  const before=await snapshot(input.path),config=await ops.readConfig(input.path);
  if(!equalFile(before,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
  const receipt={version:1,issue:1662,goalIssue:1219,nodeId:'macbook',sourceRevision:input.revision,
    phase:input.phase,observedAt:new Date().toISOString(),readOnly:input.phase==='plan',credentialChanged:false,
    transportAcceptanceVerified:false};
  if(config.JARVIS_OWNER_SECRET?.trim() || config.AI_COMPANY_OWNER_SECRET?.trim())return {...receipt,complete:true,readOnly:true,alreadyConfigured:true};
  if(!config.JARVIS_OWNER_TOKEN?.trim())throw Error('OWNER_TOKEN_MISSING');
  if(input.phase==='plan')return {...receipt,complete:true,initializationRequired:true};
  const lock=lockPath(input.path);
  let lockStat,backup,staged,afterImage,exchangeAttempted=false,releaseLock=false,stage='boundary';
  const exchange=ops.exchange || atomicOwnerFileExchange;
  try {
    await ops.recheck();checkApproval();
    if(!equalFile(before,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    stage='lock';await mkdir(lock,{mode:0o700});lockStat=await lstat(lock);
    if(lockStat.uid!==process.getuid() || lockStat.mode&0o077)throw Error('OWNER_SECRET_LOCK_REJECTED');
    await syncDirectory(dirname(input.path));
    stage='backup';checkApproval();backup=join(dirname(input.path),'.goriq-owner-secret-recovery-'+randomUUID());
    await mkdir(backup,{mode:0o700});await ops.guard(backup);
    if((await lstat(backup)).mode&0o077)throw Error('OWNER_SECRET_BACKUP_REJECTED');
    await privateWrite(join(backup,'original.env'),before.bytes);
    await privateWrite(join(backup,'baseline.json'),JSON.stringify({version:1,issue:1662,revision:input.revision,metadata:before.metadata}));
    stage='stage';checkApproval();const secret=randomBytes(32).toString('hex');
    const bytes=Buffer.concat([before.bytes,Buffer.from('\nJARVIS_OWNER_SECRET=\''+secret+'\'\n')]);
    staged=join(backup,'exchange.env');await privateWrite(staged,bytes,before.metadata.mode);afterImage=await snapshot(staged);
    if(!equalMetadata(before,afterImage))throw Error('OWNER_SECRET_METADATA_REJECTED');
    const expected={...config,JARVIS_OWNER_SECRET:secret};
    if(!isDeepStrictEqual(await ops.readConfig(staged),expected))throw Error('OWNER_SECRET_CONFIG_REJECTED');
    stage='exchange';await ops.recheck();checkApproval();
    if(!equalFile(before,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    const privateIdentity=value=>({ino:value.ino,dev:value.dev,metadata:value.metadata,
      sha256:createHash('sha256').update(value.bytes).digest('hex')});
    await privateWrite(join(backup,'transaction.json'),JSON.stringify({version:1,issue:1662,revision:input.revision,
      artifacts:input.artifacts,exchangeMayHaveOccurred:true,before:privateIdentity(before),after:privateIdentity(afterImage)}));
    await syncDirectory(backup);await syncDirectory(dirname(input.path));
    if(!equalFile(before,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    checkApproval();exchangeAttempted=true;await exchange(input.path,staged);
    await syncDirectory(backup);await syncDirectory(dirname(input.path));
    // The retired inode proves what the atomic syscall replaced, including a race after the last check.
    if(!equalFile(before,await snapshot(staged)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    stage='verify';
    if(!equalFile(afterImage,await snapshot(input.path)) || !isDeepStrictEqual(await ops.readConfig(input.path),expected))throw Error('OWNER_SECRET_VERIFICATION_FAILED');
    await ops.verifyUnrelated();
    if(!equalFile(afterImage,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    await ops.acceptVerified?.({configuration:expected,bytes:afterImage.bytes});
    if(!equalFile(afterImage,await snapshot(input.path)))throw Error('OWNER_SECRET_CONCURRENT_CHANGE');
    const result={...receipt,complete:true,credentialChanged:true,metadataPreserved:true,otherConfigurationPreserved:true,backupRetained:true};
    await privateWrite(join(backup,'receipt.json'),JSON.stringify(result));await syncDirectory(backup);releaseLock=true;return result;
  }catch {
    let restored=!exchangeAttempted,recoveryBlocked=false;
    if(exchangeAttempted) {
      try {
        const current=await snapshot(input.path),retired=await snapshot(staged);
        if(equalFile(current,before))restored=true; // syscall failed without changing the environment
        else if(equalFile(current,afterImage) && (await ops.canRestore?.() ?? true) &&
          equalFile(current,await snapshot(input.path)) && equalFile(retired,await snapshot(staged))) {
          await exchange(input.path,staged);
          await syncDirectory(backup);await syncDirectory(dirname(input.path));
          const active=await snapshot(input.path),moved=await snapshot(staged);
          restored=equalFile(retired,active) && equalFile(afterImage,moved);
          if(!restored && equalFile(retired,active)) {
            // A racing owner edit was moved aside by the reverse syscall. Put that exact inode back;
            // retain the pending marker and both images rather than accepting a new baseline.
            if(equalFile(active,await snapshot(input.path)) && equalFile(moved,await snapshot(staged))) {
              await exchange(input.path,staged);
              await syncDirectory(backup);await syncDirectory(dirname(input.path));
              if(!equalFile(moved,await snapshot(input.path)))throw Error('OWNER_SECRET_RECOVERY_CONFLICT');
            }
          }
        }
        recoveryBlocked=!restored;
      }catch {restored=false;recoveryBlocked=true;}
    }
    const result={...receipt,complete:false,failedStage:stage,failureReason:'OWNER_SECRET_INITIALIZATION_FAILED',
      credentialChanged:exchangeAttempted&&!restored,restored,recoveryBlocked,backupRetained:!!backup};
    if(backup)try{await privateWrite(join(backup,'failure.json'),JSON.stringify(result));await syncDirectory(backup);}catch{}
    releaseLock=restored && !recoveryBlocked;
    return result;
  }finally {
    if(lockStat && releaseLock)try{const live=await lstat(lock);if(live.ino===lockStat.ino && live.uid===lockStat.uid){await rmdir(lock);await syncDirectory(dirname(input.path));}}catch{}
  }
}
