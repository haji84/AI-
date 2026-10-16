// Read-only, owner-authenticated connection probe for a *real* GORIQ host.
// No task creation, remote token retrieval, code write, repair or merge.
const BROKER = "http://127.0.0.1:8787";
const BUILDER = "http://127.0.0.1:8796";
const GOAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{5,159}$/;

function hold(reason, detail={}) {
  return {
    status:"HOLD", reason,
    brokerAuthenticated:false,builderAuthenticated:false,
    goalWorkRunObserved:false,builderAcknowledged:false,
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

export async function probeLiveGoriqConnection({
  brokerUrl = BROKER, builderUrl = BUILDER,
  ownerToken, builderToken, goalId,
  fetchImpl = fetch,
} = {}) {
  if(!onlyLoopback(brokerUrl,BROKER)||
     !onlyLoopback(builderUrl,BUILDER)||
     typeof fetchImpl!=="function")
    return hold("ONLY_EXACT_LOOPBACK_ENDPOINTS_ALLOWED");
  if(typeof ownerToken!=="string"||ownerToken.trim().length<8||
     typeof builderToken!=="string"||builderToken.trim().length<8)
    return hold("EXISTING_OWNER_AND_BUILDER_CREDENTIALS_REQUIRED");
  if(goalId!==undefined && (!GOAL_ID.test(goalId)||goalId.includes("..")))
    return hold("INVALID_GOAL_IDENTIFIER");

  async function read(url,token) {
    const request={
      method:"GET",redirect:"error",
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(6000),
    };
    let response;
    try {response=await fetchImpl(url,request);}
    catch {throw Error("LOCAL_SERVICE_UNREACHABLE");}
    if(response?.ok!==true)throw Error("LOCAL_SERVICE_AUTH_OR_HTTP_FAILED");
    let json;
    try {
      const body=await response.text();
      if(body.length>16384)throw Error("OVERSIZED_LOCAL_STATUS");
      json=JSON.parse(body);
    } catch {throw Error("INVALID_LOCAL_STATUS_RESPONSE");}
    return json;
  }

  // Do not send tokens beyond local loopback. The Builder health request is
  // authenticated, but an HTTP response is only a service observation, NOT
  // a cryptographic proof of accepted work.
  let broker;
  try {broker=await read(BROKER+"/health",ownerToken);}
  catch {return hold("BROKER_NOT_REACHABLE_OR_AUTHENTICATED");}
  if(broker?.ok!==true||broker?.service!=="jarvis-broker")
    return hold("UNEXPECTED_BROKER_SERVICE");

  let builder;
  try {builder=await read(BUILDER+"/health",builderToken);}
  catch {return hold("BUILDER_NOT_REACHABLE_OR_AUTHENTICATED",{
    brokerAuthenticated:true,
  });}
  if(builder?.ok!==true||builder?.service!=="code-builder-worker"||
     !Array.isArray(builder.capabilities)||
     !builder.capabilities.includes("code-builder"))
    return hold("BUILDER_NOT_AVAILABLE",{
      brokerAuthenticated:true,
    });

  let run=null;
  if(goalId!==undefined) {
    try {run=await read(BROKER+"/api/jarvis/admin/work/"+goalId,ownerToken);}
    catch {return hold("GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND",{
      brokerAuthenticated:true,builderAuthenticated:true,
      builderIdentity:boundedIdentity(builder.workerId),
    });}
    if(run?.run?.goalId!==goalId||
       typeof run?.run?.phase!=="string"||
       !["QUEUED","RUNNING","VERIFYING","RECOVERING","BLOCKED","HUMAN_GATE","COMPLETED","FAILED"].includes(run.run.phase))
      return hold("UNTRUSTED_GOAL_RUN_RECEIPT",{
        brokerAuthenticated:true,builderAuthenticated:true,
      });
  }
  return {
    status:"READONLY_CONNECTION_CONFIRMED",
    brokerAuthenticated:true,builderAuthenticated:true,
    builderIdentity:boundedIdentity(builder.workerId),
    builderCapabilityPresent:true,
    goalWorkRunObserved:run!==null,
    goalWorkRunPhase:run?.run?.phase??null,
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
  }).then(result=>{
    console.log("AI09_LIVE_CONNECTION="+JSON.stringify(result));
    if(result.status!=="READONLY_CONNECTION_CONFIRMED")process.exitCode=2;
  }).catch(()=>{
    console.log("AI09_LIVE_CONNECTION="+JSON.stringify(hold("UNEXPECTED_PROBE_FAILURE")));
    process.exitCode=2;
  });
}
