// Read-only GORIQ WorkState acceptance check; never creates or dispatches a task.
// Only the trusted Goal Controller supplies the actual persistent WorkStateStore
// and authenticated Builder receipt reader, never a model or PR comment.
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_:/.-]{8,180}$/;
const ROLE=new Set(["Builder","Debugger"]);
const ACTIVE=new Set(["IN_PROGRESS","VERIFYING"]);

function hold(reason){
  return {status:"BUILDER_ACK_PENDING",reason,taskId:null,
    builderAcknowledged:false,taskPresentInAuthorityStore:false,
    writeAuthorized:false,githubApprovalSatisfied:false,mergeAuthorized:false};
}
export async function verifyBuilderAcknowledgement({
  goalId,proposal,workStateStore,readAuthenticatedReceipt,
}) {
  if(typeof goalId!=="string"||!ID.test(goalId)||
     typeof workStateStore?.get!=="function"||
     typeof readAuthenticatedReceipt!=="function")
    return hold("TRUSTED_WORK_STATE_AND_RECEIPT_REQUIRED");
  const task=proposal?.handoff,scope=task?.SCOPE;
  if(proposal?.status!=="VERIFIED_CANDIDATE"||
     proposal?.independentVerificationSatisfied!==true||
     proposal?.correctionTaskCreated!==false||
     proposal?.builderAcknowledged!==false||
     proposal?.writeAuthorized!==false||proposal?.mergeAuthorized!==false||
     task?.STATUS!=="PROPOSAL_PENDING_AUTHORITY_AND_ACK"||
     !ID.test(task.TASK_ID??"")||
     task.TARGET_AGENT!=="Builder/Debugger"||
     !SHA40.test(scope?.headSha??"")||!SHA40.test(scope?.baseSha??"")||
     !SHA256.test(scope?.patchSha256??"")||
     !Array.isArray(task.FILES_ALLOWED)||task.FILES_ALLOWED.length!==1||
     scope.path!==task.FILES_ALLOWED[0]||
     !ID.test(task.VERIFIED_EVIDENCE?.id??""))
    return hold("INVALID_VERIFIED_TASK_PROPOSAL");
  let state,ack;
  try {
    // Compass-backed WorkStateStore.read is the durable authority for
    // work items. Ack must come from trusted runtime identity, not AI text.
    state=await workStateStore.get(goalId);
    ack=await readAuthenticatedReceipt(task.TASK_ID);
  } catch {
    return hold("AUTHORITY_STATE_OR_ACK_UNAVAILABLE");
  }
  if(!state||state.goalId!==goalId||
     !Array.isArray(state.childWorkItems))
    return hold("NO_AUTHORITATIVE_GOAL_WORK_STATE");
  const items=state.childWorkItems.filter(x=>x?.id===task.TASK_ID);
  if(items.length!==1||!ACTIVE.has(items[0].status)||
     !Array.isArray(items[0].affectedScope)||
     items[0].affectedScope.length!==1||
     items[0].affectedScope[0]!==scope.path)
    return hold("BUILDER_TASK_NOT_ACTIVE_IN_WORK_STATE");
  if(ack?.taskId!==task.TASK_ID||ack?.goalId!==goalId||
     ack?.workItemId!==items[0].id||ack?.status!=="ACKNOWLEDGED"||
     ack?.issuer!=="GORIQ_GOAL_CONTROLLER"||
     !ROLE.has(ack?.builderRole)||
     ack?.headSha!==scope.headSha||ack?.baseSha!==scope.baseSha||
     ack?.patchSha256!==scope.patchSha256||
     ack?.verificationEvidenceId!==task.VERIFIED_EVIDENCE.id||
     !ID.test(ack?.receiptId??"")||
     typeof ack?.builderIdentity!=="string"||
     !/^[A-Za-z0-9_.-]{2,80}$/.test(ack.builderIdentity)||
     ack.builderIdentity.toLowerCase()==="ai-09"||
     !Number.isFinite(Date.parse(ack?.acceptedAt??"")))
    return hold("BUILDER_RECEIPT_NOT_AUTHENTICATED_OR_STALE");
  // Acknowledgment does NOT grant the agent writes, merge/deploy rights,
  // or certify a fix. Those remain separate Goal/State/Approval gates.
  return {status:"BUILDER_RECEIPT_MATCHED",reason:"TRUSTED_STORE_AND_RECEIPT_AGREE",
    taskId:task.TASK_ID,receiptId:ack.receiptId,
    builderRole:ack.builderRole,
    builderAcknowledged:true,taskPresentInAuthorityStore:true,
    writeAuthorized:false,githubApprovalSatisfied:false,mergeAuthorized:false};
}
