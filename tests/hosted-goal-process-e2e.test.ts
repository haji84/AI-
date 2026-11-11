import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

interface ProcessSnapshot {
  proofClass: string;stage: string;pid: number;goalId: string;
  jobIds: string[];phases: string[];starts: number[];acceptance: string[];
  signedFixtureNotIndependent: boolean;githubRunId: string|null;githubSha: string|null;
}

test("hosted Goal intake starts A, survives actual Node process restart, verifies and automatically starts distinct B", {timeout:65_000}, () => {
  const root=mkdtempSync(join(tmpdir(),"goriq-hosted-process-"));
  // Deliberately do NOT inherit any repository, owner, cloud-model or private
  // verifier token into these ephemeral fixture subprocesses.
  const safeKeys=["PATH","SystemRoot","WINDIR","HOME","TMP","TEMP","TMPDIR","GITHUB_SHA","GITHUB_RUN_ID","RUNNER_ENVIRONMENT","RUNNER_OS","CI"];
  const env:NodeJS.ProcessEnv={GORIQ_CI_FIXTURE_ONLY:"1",NODE_ENV:"test"};
  for(const key of safeKeys)if(process.env[key]!==undefined)env[key]=process.env[key];
  const snapshots:ProcessSnapshot[]=[];
  const run=(stage:string):ProcessSnapshot=>{
    const child=spawnSync(process.execPath,["tests/fixtures/goriq-hosted-goal-process.ts",stage,root],{
      encoding:"utf8",cwd:process.cwd(),env,timeout:20000,maxBuffer:1024*1024,
      windowsHide:true,
    });
    assert.equal(child.error,undefined,"test child process must exit: "+String(child.error));
    assert.equal(child.status,0,"test stage "+stage+" failed: "+String(child.stderr).slice(-1000));
    const line=(child.stdout??"").split(/\r?\n/).find(l=>l.startsWith("GORIQ_HOSTED_PROCESS_E2E="));
    assert.ok(line,"missing actual process marker for "+stage);
    const result=JSON.parse(line.slice("GORIQ_HOSTED_PROCESS_E2E=".length)) as ProcessSnapshot;
    assert.equal(result.proofClass,"CI_FIXTURE_PROCESS_ONLY_NOT_PRODUCTION");
    assert.equal(result.stage,stage);
    assert.equal(result.signedFixtureNotIndependent,true);
    assert.ok(Number.isInteger(result.pid)&&result.pid>0);
    snapshots.push(result);
    return result;
  };
  try{
    const initial=run("init");
    assert.deepEqual(initial.jobIds,["hosted-a","hosted-b"]);
    assert.deepEqual(initial.phases,["QUEUED","QUEUED"]);
    assert.deepEqual(initial.starts,[0,0]);
    const first=run("first");
    assert.equal(first.goalId,initial.goalId);
    assert.deepEqual(first.phases,["VERIFYING","QUEUED"]);
    assert.deepEqual(first.starts,[1,0]);
    assert.deepEqual(first.acceptance,[]);
    const resumed=run("resume");
    assert.equal(resumed.goalId,initial.goalId);
    assert.deepEqual(resumed.jobIds,initial.jobIds);
    assert.deepEqual(resumed.phases,["COMPLETED","COMPLETED"]);
    assert.deepEqual(resumed.starts,[1,1]);
    assert.deepEqual(resumed.acceptance,["hosted-a","hosted-b"]);
    const replay=run("replay");
    assert.equal(replay.goalId,initial.goalId);
    assert.deepEqual(replay.phases,resumed.phases);
    assert.deepEqual(replay.starts,[1,1]);
    assert.deepEqual(new Set(snapshots.map(s=>s.pid)).size,4,"every stage must be a separate OS process");
    // Re-read the durable Job state rather than trusting only stdout of the
    // executor; the fixture is not an independently provisioned verifier.
    const durable=JSON.parse(readFileSync(join(root,"jobs.json"),"utf8")) as {
      jobs:Array<{jobId:string;phase:string;history:Array<{to:string}>}>
    };
    assert.deepEqual(durable.jobs.map(j=>j.jobId),resumed.jobIds);
    assert.deepEqual(durable.jobs.map(j=>j.phase),["COMPLETED","COMPLETED"]);
    assert.deepEqual(durable.jobs.map(j=>j.history.filter(h=>h.to==="IMPLEMENTING").length),[1,1]);
    console.log("GORIQ_HOSTED_PROCESS_CHAIN_PROVED="+JSON.stringify({
      proofClass:"CI_FIXTURE_WITH_SYNTHETIC_SIGNER_NOT_PRODUCTION",
      gitHubRunId:process.env.GITHUB_RUN_ID??null,
      sourceSha:process.env.GITHUB_SHA??null,
      goalId:initial.goalId,jobIds:resumed.jobIds,jobStarts:resumed.starts,
      processRestartCount:3,uniquePids:4,
      originalJobRecoveredFromVerifying:true,
      canonicalGoalCriteria:resumed.acceptance,
      noDuplicateOnReplay:true,realNodeProcesses:true,
      actualExternalVerifier:false,ownerCredentialUsed:false,
    }));
  }finally{rmSync(root,{recursive:true,force:true});}
});
