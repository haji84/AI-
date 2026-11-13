// Read-only, owner-authenticated connection probe for a *real* GORIQ host.
// No task creation, remote token retrieval, code write, repair or merge.
const BROKER = "http://127.0.0.1:8787";
const BUILDER = "http://127.0.0.1:8796";
const GOAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{5,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const JOB_PHASES = new Set(["QUEUED","PLANNING","IMPLEMENTING","WAITING_FOR_CONNECTIVITY",
  "WAITING_FOR_RESOURCE","VERIFYING","RECOVERING","READY_TO_PUBLISH","PUBLISHING",
  "HUMAN_GATE","BLOCKED","COMPLETED","CANCELLED"]);

function hold(reason, detail={}) {
  return {
    status:"HOLD", reason,
    brokerAuthenticated:false,builderAuthenticated:false,
    goalWorkRunObserved:false,jobReadbackObserved:false,jobReadbackPhase:null,jobRecordSha256:null,
    localReadbackConsistent:false,goalContractDigest:null,
    builderAcknowledged:false,
    actualBuilderReceiptId:null,actualTaskId:null,
    writeAuthorized:false,mergeAuthorized:false,
    ...detail,
  };
}

function onlyLoopback(url,expected) {
  if(typeof url!=="string")return false;
  try {
    const u=new URL(url);
    return u.href===expected+"/" && u.protocol==="http:" &&
      u.hostname==="127.0.0.1" &&
      u.username==="" && u.password==="" && u.search==="" && u.hash==="";
  } catch { return false; }
}

function boundedIdentity(value) {
  if(typeof value!=="string" || value.length>80 ||
     !/^[A-Za-z0-9_.:-]{1,80}$/.test(value))return null;
  return value;
}

// Normalize only the selected persisted Job. This projection proves two local
// observations agree; it is never a remote lease, signature or execution grant.
function jobSnapshot(run, goalId, jobId) {
  const proof=run?.jobReadback;
  const matches=Array.isArray(proof?.jobs) ? proof.jobs.filter(job=>job?.jobId===jobId) : [];
  const exact=matches.length===1 ? matches[0] : null;
  const scope=exact?.approvalScope;
  if(proof?.kind!=="LOCAL_PERSISTED_JOBS" || proof.goalId!==goalId ||
     typeof proof.goalDigest!=="string" || !DIGEST.test(proof.goalDigest) ||
     !Array.isArray(proof.jobs) || proof.jobs.length>32 ||
     !exact || !JOB_PHASES.has(exact.phase) ||
     typeof exact.recordSha256!=="string" || !DIGEST.test(exact.recordSha256) ||
     typeof scope?.taskScopeId!=="string" || !scope.taskScopeId.trim() ||
     !["low","medium","high","critical"].includes(scope.maxRisk) ||
     (scope.expiresAt!==undefined &&
       (typeof scope.expiresAt!=="string" || !Number.isFinite(Date.parse(scope.expiresAt)) ||
        Date.parse(scope.expiresAt)<=Date.now())))return null;
  return {
    goalId,goalDigest:proof.goalDigest,jobId,
    phase:exact.phase,recordSha256:exact.recordSha256,
    taskScopeId:scope.taskScopeId,maxRisk:scope.maxRisk,expiresAt:scope.expiresAt??null,
  };
}

export async function probeLiveGoriqConnection({
  brokerUrl = BROKER, builderUrl = BUILDER,
  ownerToken, builderToken, goalId, jobId, mode = "combined",
  fetchImpl = fetch,
} = {}) {
  if(!onlyLoopback(brokerUrl,BROKER)||
     !onlyLoopback(builderUrl,BUILDER)||
     typeof fetchImpl!=="function")
    return hold("ONLY_EXACT_LOOPBACK_ENDPOINTS_ALLOWED");
  if(!["combined","broker","builder"].includes(mode))
    return hold("UNSUPPORTED_CONNECTION_SCOPE");
  if((mode!=="builder" && (typeof ownerToken!=="string"||ownerToken.trim().length<8))||
     (mode!=="broker" && (typeof builderToken!=="string"||builderToken.trim().length<8)))
    return hold("EXISTING_SCOPED_CREDENTIALS_REQUIRED");
  // A Job request must be explicitly bound to one well-formed owner Goal.
  if(jobId!==undefined && (mode==="builder" || typeof goalId!=="string" ||
     !GOAL_ID.test(goalId) || goalId.includes("..") ||
     typeof jobId!=="string" || !GOAL_ID.test(jobId) || jobId.includes("..")))
    return hold("INVALID_JOB_IDENTIFIER");
  if(goalId!==undefined && (mode==="builder"||
     !GOAL_ID.test(goalId)||goalId.includes("..")))
    return hold("INVALID_GOAL_IDENTIFIER");

  // This diagnostic is a fixed enum and a bounded HTTP number only. It never
  // contains an endpoint, credential, response body or exception message.
  let readFailure=null;
  async function read(url,token) {
    readFailure={kind:"TRANSPORT",httpStatus:null};
    const request={
      method:"GET",redirect:"error",
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(6000),
    };
    let response;
    try {response=await fetchImpl(url,request);}
    catch {throw Error("LOCAL_SERVICE_UNREACHABLE");}
    const httpStatus=Number.isInteger(response?.status) && response.status>=100 && response.status<=599
      ? response.status : null;
    readFailure={kind:"HTTP",httpStatus};
    if(response?.ok!==true)throw Error("LOCAL_SERVICE_AUTH_OR_HTTP_FAILED");
    let json;
    try {
      readFailure={kind:"BODY",httpStatus};
      const body=await response.text();
      if(typeof body!=="string")throw Error("INVALID_LOCAL_STATUS_RESPONSE");
      readFailure={kind:"SIZE",httpStatus};
      if(body.length>16384)throw Error("OVERSIZED_LOCAL_STATUS");
      readFailure={kind:"JSON",httpStatus};
      json=JSON.parse(body);
    } catch {throw Error("INVALID_LOCAL_STATUS_RESPONSE");}
    readFailure=null;
    return json;
  }

  // Do not send tokens beyond local loopback. The Builder health request is
  // authenticated, but an HTTP response is only a service observation, NOT
  // a cryptographic proof of accepted work.
  if(mode!=="builder") {
  let broker;
  try {broker=await read(BROKER+"/health",ownerToken);}
  catch {return hold("BROKER_NOT_REACHABLE_OR_AUTHENTICATED");}
  if(broker?.ok!==true||broker?.service!=="jarvis-broker")
    return hold("UNEXPECTED_BROKER_SERVICE");
  // /health is publicly reachable. Only an owner-guarded admin endpoint can
  // authenticate the existing owner credential; never confuse reachability
  // with successful owner authorization.
  let ownerProof;
  try {
    ownerProof=await read(
      BROKER+"/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe",
      ownerToken,
    );
  } catch {return hold("OWNER_AUTHENTICATION_NOT_VERIFIED");}
  if(!Array.isArray(ownerProof?.events))
    return hold("UNEXPECTED_OWNER_AUTH_RESPONSE");

  }

  let builder;
  if(mode!=="broker") {
  try {builder=await read(BUILDER+"/health",builderToken);}
  catch {return hold("BUILDER_NOT_REACHABLE_OR_AUTHENTICATED",{
    brokerAuthenticated:mode!=="builder",
  });}
  if(builder?.ok!==true||builder?.service!=="code-builder-worker"||
     !Array.isArray(builder.capabilities)||
     !builder.capabilities.includes("code-builder"))
    return hold("BUILDER_NOT_AVAILABLE",{
      brokerAuthenticated:mode!=="builder",
    });
  }

  let run=null;
  let boundJob=null;
  if(goalId!==undefined) {
    try {run=await read(BROKER+"/api/jarvis/admin/work/"+goalId,ownerToken);}
    catch {return hold("GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND",{
      readFailure,
      brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
      builderIdentity:builder?boundedIdentity(builder.workerId):null,
    });}
    if(run?.run?.goalId!==goalId||
       typeof run?.run?.phase!=="string"||
       !["QUEUED","RUNNING","VERIFYING","RECOVERING","BLOCKED","HUMAN_GATE","COMPLETED","FAILED"].includes(run.run.phase))
      return hold("UNTRUSTED_GOAL_RUN_RECEIPT",{
        brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
      });
    // The owner-authenticated WorkRun endpoint also serves historical records.
    // A matching run ID or phase is never proof that this is today's canonical Goal.
    if(run.goalAuthority?.kind!=="CURRENT_COMPASS_GOAL"||
       run.goalAuthority.goalId!==goalId||
       run.goalAuthority.current!==true)
      return hold("GOAL_AUTHORITY_NOT_VERIFIED",{
        brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
        builderIdentity:builder?boundedIdentity(builder.workerId):null,
      });
    if(jobId!==undefined) {
      const first=jobSnapshot(run,goalId,jobId);
      if(!first)
        return hold("JOB_READBACK_NOT_AUTHENTICATED",{
          brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
          goalWorkRunObserved:true,
        });
      // Exactly one new authenticated GET, not a retry loop or a second authority.
      // Revalidate expiry and compare the canonical Goal, selected Job and scope.
      let repeated;
      try {repeated=await read(BROKER+"/api/jarvis/admin/work/"+goalId,ownerToken);}
      catch {return hold("JOB_READBACK_REPEAT_UNAVAILABLE",{
        readFailure,
        brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
      });}
      const second=jobSnapshot(repeated,goalId,jobId);
      if(repeated?.run?.goalId!==goalId || repeated.run.phase!==run.run.phase ||
         repeated.goalAuthority?.kind!=="CURRENT_COMPASS_GOAL" ||
         repeated.goalAuthority.goalId!==goalId || repeated.goalAuthority.current!==true ||
         !second || JSON.stringify(first)!==JSON.stringify(second))
        return hold("JOB_READBACK_CHANGED",{
          brokerAuthenticated:true,builderAuthenticated:mode!=="broker",
        });
      run=repeated;
      boundJob=second;
    }
  }
  return {
    status:mode==="broker"?"BROKER_AUTHENTICATED_READONLY":
      mode==="builder"?"BUILDER_AUTHENTICATED_READONLY":"READONLY_CONNECTION_CONFIRMED",
    brokerAuthenticated:mode!=="builder",
    builderAuthenticated:mode!=="broker",
    builderIdentity:builder?boundedIdentity(builder.workerId):null,
    builderCapabilityPresent:mode!=="broker",
    goalWorkRunObserved:run!==null,
    goalWorkRunPhase:run?.run?.phase??null,
    jobReadbackObserved:boundJob!==null,
    jobReadbackPhase:boundJob?.phase??null,
    jobRecordSha256:boundJob?.recordSha256??null,
    localReadbackConsistent:boundJob!==null,
    goalContractDigest:boundJob?.goalDigest??null,
    // The Broker /work/:goalId endpoint does NOT furnish an authenticated
    // Builder's task acceptance receipt. Never infer that from run phase.
    builderAcknowledged:false,
    actualBuilderReceiptId:null,actualTaskId:null,
    writeAuthorized:false,mergeAuthorized:false,
    completionClaim:false,
  };
}

if(process.argv[1]?.endsWith("goriq-ai09-live-broker-builder-probe.mjs")){
  probeLiveGoriqConnection({
    ownerToken:process.env.JARVIS_OWNER_TOKEN,
    builderToken:process.env.CODE_BUILDER_LOCAL_TOKEN||process.env.CODE_BUILDER_TOKEN,
    goalId:process.env.GORIQ_AI09_GOAL_ID||undefined,
    jobId:process.env.GORIQ_AI09_JOB_ID||undefined,
    mode:process.env.GORIQ_AI09_CONNECT_MODE||"combined",
  }).then(result=>{
    console.log("AI09_LIVE_CONNECTION="+JSON.stringify(result));
    if(!["READONLY_CONNECTION_CONFIRMED","BROKER_AUTHENTICATED_READONLY",
      "BUILDER_AUTHENTICATED_READONLY"].includes(result.status))process.exitCode=2;
  }).catch(()=>{
    console.log("AI09_LIVE_CONNECTION="+JSON.stringify(hold("UNEXPECTED_PROBE_FAILURE")));
    process.exitCode=2;
  });
}
