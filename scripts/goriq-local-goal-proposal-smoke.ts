import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {CompassStore} from "../src/compass/store.ts";
import {CognitiveService} from "../src/gai/cognitive-service.ts";
if(!process.env.GAI_LOCAL_MODEL_NAME?.trim())throw Error("Specify an already installed local model; no download is performed");
const root=await mkdtemp(join(tmpdir(),"goriq-local-goal-draft-"));if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error("Unexpected temporary path");
try{
 const dbPath=join(root,"compass.db"),dataRoot=join(root,"data");await mkdir(dataRoot);
 const db=new CompassStore(dbPath);db.setGoal({title:"添付するテキストの内容を変えずに、ダウンロードできるファイルとして保存して",constraints:["ローカル処理のみ","元の内容を変更しない"]});const before={goal:db.getGoal(),state:db.getState()};db.close();
 const service=new CognitiveService(dbPath,{materialIntake:{dataRoot}}),status=await service.status(),started=Date.now();
 const proposal=await service.proposeGoalCriteria({goalId:status.goalId,goalDigest:status.goalDigest});
 const after=new CompassStore(dbPath);try{assert.deepEqual({goal:after.getGoal(),state:after.getState()},before);}finally{after.close();}
 assert.equal(proposal.status,"PROPOSED");assert.equal(proposal.verification,"UNVERIFIED");assert.ok(proposal.draft.successCriteria.length>0);assert.equal((await service.status()).attempts,0);
 console.log(JSON.stringify({passed:true,model:process.env.GAI_LOCAL_MODEL_NAME,elapsedMs:Date.now()-started,goalUnchanged:true,executedActions:0,externalAiCalls:0,proposalOnly:true,generalSemanticAccuracyClaim:false,draft:proposal.draft},null,2));
}finally{await rm(root,{recursive:true,force:true});}
