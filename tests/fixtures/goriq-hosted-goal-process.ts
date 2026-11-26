/**
 * GitHub-hosted CI fixture, never an owner runtime or a deployment entrypoint.
 * Each invocation is a fresh OS process. All files live in a disposable temp
 * directory. Signer keys are synthetic and do NOT prove principal separation.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CompassStore } from "../../src/compass/store.ts";
import { CompassGoalRegistryAdapter, CompassGoalDecisionStoreAdapter } from "../../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkStateStoreAdapter } from "../../src/orchestrator/compass-work-state-store.ts";
import { mergeDefinitionOfDoneResults } from "../../src/orchestrator/work-state.ts";
import { GoalControllerRuntime } from "../../src/orchestrator/goal-controller-runtime.ts";
import { GoalControllerExecutionBridge } from "../../src/orchestrator/goal-controller-execution-bridge.ts";
import { HostedGoalControllerAdapter, type HostedJobAuthority, type HostedJobBinding } from "../../src/orchestrator/hosted-goal-controller-adapter.ts";
import { createDevelopmentJob } from "../../src/orchestrator/development-job.ts";
import { JsonFileDevelopmentJobStore } from "../../src/orchestrator/development-job-store.ts";
import { createDevelopmentChangeSet } from "../../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentVerificationPlan } from "../../src/orchestrator/development-verification-plan.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierReceipt } from "../../src/orchestrator/signed-local-verifier-receipt.ts";
import type { FabricNode } from "../../src/orchestrator/capability-fabric-router.ts";

const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const baseRevision="a".repeat(40);
const scope="issue:1219:github-hosted-process-fixture";
const goalRequest={
  source:"github" as const,
  text:"Complete two exact, bounded public files",
  idempotencyKey:"ci:1219:process-bound-hosted-goal",
  goalContract:{
    successCriteria:["Artifact A verified","Artifact B verified"],
    constraints:["No publication","CI fixture signer is not independently provisioned"],
  },
};
const values:Record<string,string>={"hosted-a":"first real process artifact\n","hosted-b":"second real process artifact\n"};
const jobPaths:Record<string,string>={"hosted-a":"tests/fixtures/hosted-a-process.txt","hosted-b":"tests/fixtures/hosted-b-process.txt"};
const nodes:FabricNode[]=[{
  id:"github-hosted-ci",kind:"cloud",capabilities:["repository.inspect"],
  online:true,healthy:true,privacy:"public-ok",incrementalCost:0,
  latencyMs:100,reliability:0.99,evidenceModes:["ONLINE"],
}];
const bindings=(goalId:string):HostedJobBinding[]=>[
  {goalId,jobId:"hosted-a",dependsOn:[],allowedPaths:[jobPaths["hosted-a"]!],privacy:"public",evidenceMode:"ONLINE"},
  {goalId,jobId:"hosted-b",dependsOn:["hosted-a"],allowedPaths:[jobPaths["hosted-b"]!],privacy:"public",evidenceMode:"ONLINE"},
];
if(process.env.GORIQ_CI_FIXTURE_ONLY!=="1")throw Error("CI_FIXTURE_OPT_IN_REQUIRED");
const stage=process.argv[2],root=process.argv[3];
if(!["init","first","resume","replay"].includes(stage||"")||
  typeof root!=="string"||!resolve(root)||!root.includes("goriq-hosted-process-")||root.includes("\0"))throw Error("CI_FIXTURE_ARGUMENTS_INVALID");
const files={
  compass:join(root,"compass.db"), jobs:join(root,"jobs.json"), changes:join(root,"changes.json"),
  privateKey:join(root,"fixture-signing-key.pem"), publicKey:join(root,"fixture-signing-pub.pem"),
};
const compass=new CompassStore(files.compass);
try {
  const registry=new CompassGoalRegistryAdapter(compass);
  const controller=new GoalControllerRuntime({registry,decisionStore:new CompassGoalDecisionStoreAdapter(compass)});
  const decision=await controller.handle(goalRequest);
  assert.equal(decision.action,"CONTINUE_GOAL");
  const goalId=decision.goalId!;
  if(stage==="init"){
    assert.ok(!existsSync(files.privateKey),"CI fixture must not overwrite existing signer");
    const key=generateKeyPairSync("ed25519");
    writeFileSync(files.privateKey,key.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600,flag:"wx"});
    writeFileSync(files.publicKey,key.publicKey.export({type:"spki",format:"pem"}),{mode:0o600,flag:"wx"});
    await new CompassWorkStateStoreAdapter(compass).put({
      goalId,objective:goalRequest.text,definitionOfDone:[
        {id:"hosted-a",description:"Exact A accepted",required:true},
        {id:"hosted-b",description:"Exact B accepted",required:true},
      ],currentState:"Accepted fixture Goal",status:"IN_PROGRESS",riskClass:"R0",
      constraints:[...goalRequest.goalContract.constraints],decisions:[],artifacts:[],
      verificationResults:[],childWorkItems:[],blockers:[],
      nextAction:"Start hosted-a",updatedAt:new Date().toISOString(),
    });
    const jobs=new JsonFileDevelopmentJobStore(files.jobs);
    for(const item of bindings(goalId))await jobs.put(createDevelopmentJob({
      jobId:item.jobId,goalId,requirementIds:["AUTO-010"],acceptanceCriteria:[item.jobId],
      definitionOfDone:[{id:item.jobId,description:"Verified exact file",required:true}],
      baseRevision,approvalScope:{taskScopeId:scope,maxRisk:"low"},
      workItems:[{id:item.jobId+":work",objective:"Create exact disposable CI fixture",
        dependsOn:[],requiredCapabilities:["repository.inspect"]}],
    }));
  }else{
    const authority:HostedJobAuthority={
      async assertEligible({goalId:claimedGoal,jobId,nodeId}){
        assert.equal(claimedGoal,goalId);
        assert.ok(Object.hasOwn(values,jobId));
        assert.equal(nodeId,"github-hosted-ci");
        assert.equal(process.env.GORIQ_CI_FIXTURE_ONLY,"1");
      },
      async currentGate(){return{paused:false,blockers:[]};},
      async build({job,allowedPaths}){
        const expected=values[job.jobId];
        assert.ok(expected);
        assert.deepEqual(allowedPaths,[jobPaths[job.jobId]]);
        const file=join(root,"candidate",allowedPaths[0]!);
        mkdirSync(dirname(file),{recursive:true});
        writeFileSync(file,expected,{flag:"wx"});
        const actual=readFileSync(file);
        const digest=hash(actual);
        const independentProcessDigest=execFileSync(process.execPath,[
          "-e","process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex'))",
          file,
        ],{encoding:"utf8",timeout:5000,windowsHide:true}).trim();
        assert.equal(digest,independentProcessDigest);
        const changeSet=createDevelopmentChangeSet({
          changeSetId:job.jobId+":candidate",jobId:job.jobId,workItemId:job.workItems[0]!.id,
          deviceId:"ci-fixture-builder",baseRevision,changedPaths:allowedPaths,
          affectedSymbols:[],patchDigest:digest,artifactDigest:digest,evidenceDigest:hash("fixture:"+job.jobId),
          rollback:{kind:"git-base",reference:baseRevision},
        });
        const plan=createDevelopmentVerificationPlan({
          builderId:changeSet.deviceId,sourceRevision:changeSet.candidateRevision,
          artifactDigest:changeSet.artifactDigest,changedPaths:changeSet.changedPaths,
        });
        const now=new Date().toISOString();
        // CI-only fabricated test check records. No external verifier attestation.
        const payload={
          version:1 as const,verifierId:"ci-fixture-signer-not-independent",
          goalId,jobId:job.jobId,changeSetId:changeSet.changeSetId,
          builderId:changeSet.deviceId,baseRevision,
          sourceRevision:changeSet.candidateRevision,artifactDigest:changeSet.artifactDigest,
          issuedAt:now,expiresAt:new Date(Date.now()+600_000).toISOString(),
          checks:plan.requiredChecks.map(check=>({
            check,status:"passed" as const,outputDigest:hash("synthetic:"+check+":"+digest),recordedAt:now,
          })),
        };
        const signature=sign(null,Buffer.from(canonicalLocalVerifierPayload(payload)),
          readFileSync(files.privateKey)).toString("base64");
        writeFileSync(join(root,"receipt-"+job.jobId+".json"),
          JSON.stringify({payload,signatureBase64:signature}),{flag:"wx"});
        return changeSet;
      },
      async readVerifierReceipt(job){
        // Stage 1 stops with the signed receipt present on disk but not yet
        // adopted. A fresh process must perform independent receipt acceptance.
        if(stage==="first")return null;
        const path=join(root,"receipt-"+job.jobId+".json");
        return existsSync(path)?JSON.parse(readFileSync(path,"utf8")) as SignedLocalVerifierReceipt:null;
      },
      async verifyArtifactAcceptance({job,candidate}){
        const file=join(root,"candidate",jobPaths[job.jobId]!);
        if(!existsSync(file)||hash(readFileSync(file))!==candidate.artifactDigest||
          readFileSync(file,"utf8")!==values[job.jobId])return false;
        const store=new CompassWorkStateStoreAdapter(compass);
        const current=await store.get(goalId);
        assert.ok(current);
        await store.put(mergeDefinitionOfDoneResults(current,[{
          itemId:job.jobId,passed:true,evidence:{
            proofClass:"CI_SYNTHETIC_SIGNER_NO_INDEPENDENT_PRINCIPAL",
            actualFileSha256:candidate.artifactDigest,
          },
        }],new Date().toISOString()));
        return true;
      },
    };
    const adapter=new HostedGoalControllerAdapter({
      goalId,baseRevision,taskScopeId:scope,builderId:"ci-fixture-builder",
      verifierId:"ci-fixture-signer-not-independent",
      verifierPublicKeyPem:readFileSync(files.publicKey,"utf8"),
      bindings:bindings(goalId),nodes,jobs:new JsonFileDevelopmentJobStore(files.jobs),
      changes:new JsonFileDevelopmentChangeSetStore(files.changes),
      goalWorkState:new CompassWorkStateStoreAdapter(compass),authority,
    });
    const bridge=new GoalControllerExecutionBridge(adapter);
    const result=await bridge.executeUntilGoalTerminal(decision,{maxRuns:stage==="first"?1:3});
    if(stage==="first")assert.equal(result.reason,"verification_wait");
    else assert.equal(result.reason,"goal_complete");
  }
  const finalJobs=await new JsonFileDevelopmentJobStore(files.jobs).getByGoal(goalId);
  const state=await new CompassWorkStateStoreAdapter(compass).get(goalId);
  const output={
    proofClass:"CI_FIXTURE_PROCESS_ONLY_NOT_PRODUCTION",
    stage,pid:process.pid,goalId,jobIds:finalJobs.map(job=>job.jobId),
    phases:finalJobs.map(job=>job.phase),
    starts:finalJobs.map(job=>job.history.filter(e=>e.to==="IMPLEMENTING").length),
    acceptance:state?.verificationResults.filter(r=>r.passed).map(r=>r.itemId).sort()??[],
    signedFixtureNotIndependent:true,
    githubRunId:process.env.GITHUB_RUN_ID??null,
    githubSha:process.env.GITHUB_SHA??null,
  };
  console.log("GORIQ_HOSTED_PROCESS_E2E="+JSON.stringify(output));
}finally{compass.close();}
