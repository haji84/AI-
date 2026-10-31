import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";

const base = "a".repeat(40);
const art = "b".repeat(64);
const goal = { title: "Implement trusted TDD", description: "Add bounded code", successCriteria: ["acceptance"], constraints: [] };
function hostFixture(verifyRed: NonNullable<ResidentDevelopmentStages["verifyRed"]>) {
  const root=mkdtempSync(join(tmpdir(),"goriq-host-red-"));
  const jobs=new JsonFileDevelopmentJobStore(join(root,"jobs.json"));
  const changes=new JsonFileDevelopmentChangeSetStore(join(root,"changes.json"));
  let writes=0;
  const stages: ResidentDevelopmentStages={
    async build({job,workItemId}) {
      writes++;
      const red=workItemId.endsWith(":test");
      return createDevelopmentChangeSet({
        changeSetId:`${job.jobId}:${red?"red":"green"}`,
        jobId:job.jobId,workItemId,deviceId:"local-ollama-builder",
        baseRevision:base,changedPaths:[red?"tests/fixtures/test.py":"tests/fixtures/impl.py"],
        affectedSymbols:[],patchDigest:art,artifactDigest:art,
        artifactRef:`sha256:${art}`,...(red?{tddPhase:"red" as const,tddEvidenceDigest:"f".repeat(64)}:{}),
        evidenceDigest:"e".repeat(64),rollback:{kind:"git-base" as const,reference:base},
      });
    },
    verifyRed,
    async verify() { return []; },
    async releaseState() { throw Error("release must not be reached"); },
  };
  return {jobs,changes,run:()=>new ResidentDevelopmentGoalHost({
    jobs,changeSets:changes,stages,
    planning:{requirementIds:["CORE-014"],baseRevision:base,taskScopeId:"goal:bounded",
      maxRisk:"low",targetFiles:["tests/fixtures/impl.py"],contextDigest:"c".repeat(64)},
  }).run({goalId:"red-fixture-goal",goal,context:[]}),
  getWrites:()=>writes,close:()=>rmSync(root,{recursive:true,force:true})};
}
test("resident development refuses forged independent RED attestation before implementation", async()=>{
  const f=hostFixture(async()=>({digest:"unverified",issuer:"not-a-verifier"}));
  try{
    await assert.rejects(f.run(),/independent RED attestation rejected/);
    assert.equal(f.getWrites(),1);
    assert.deepEqual(await f.changes.list(),[]);
    const job=(await f.jobs.getByGoal("red-fixture-goal"))[0]!;
    assert.equal(job.evidence.some(e=>e.kind==="development-tdd-red"),false);
  }finally{f.close();}
});
test("independent RED issuer and digest replace the Builder self-assertion durably",async()=>{
  const independent="1".repeat(64);
  const f=hostFixture(async()=>({digest:independent,issuer:"local-tdd-separate-process"}));
  try{
    const run=await f.run();
    assert.equal(run.goalEvaluation?.achieved,false);
    assert.equal(f.getWrites(),2);
    const changes=await f.changes.list();
    const red=changes.find(c=>c.tddPhase==="red");
    assert.equal(red?.status,"VERIFIED");
    assert.equal(red?.tddEvidenceDigest,independent);
    const job=(await f.jobs.getByGoal("red-fixture-goal"))[0]!;
    const evidence=job.evidence.find(e=>e.kind==="development-tdd-red");
    assert.equal(evidence?.issuer,"local-tdd-separate-process");
    assert.equal(evidence?.artifactDigest,independent);
  }finally{f.close();}
});
