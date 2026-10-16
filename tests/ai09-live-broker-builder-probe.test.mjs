import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeLiveGoriqConnection } from "../scripts/goriq-ai09-live-broker-builder-probe.mjs";
const OWNER="fixture_only_owner_token";
const BUILDER="fixture_only_builder_token";
const result=(body,status=200)=>({ok:status===200,status,text:async()=>JSON.stringify(body)});
const broker={ok:true,service:"jarvis-broker",runtimeRevision:"abc123"};
const builder={ok:true,service:"code-builder-worker",workerId:"zbook",capabilities:["code-builder","filesystem"]};
function fixture({failPath,runPhase="RUNNING",builderPayload=builder,brokerPayload=broker}={}){
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    if(url.includes(failPath??"___disabled___"))return result({message:"denied"},401);
    if(url==="http://127.0.0.1:8787/health")return result(brokerPayload);
    if(url==="http://127.0.0.1:8787/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe")return result({events:[]});
    if(url==="http://127.0.0.1:8796/health")return result(builderPayload);
    if(url==="http://127.0.0.1:8787/api/jarvis/admin/work/goal-test-123")
      return result({run:{goalId:"goal-test-123",phase:runPhase}});
    throw Error("UNEXPECTED_REMOTE_PATH");
  };
  return {calls,fetchImpl};
}

test("authenticates existing local Broker and Builder and does not claim task receipt",async()=>{
  const ctx=fixture();
  const r=await probeLiveGoriqConnection({
    ownerToken:OWNER,builderToken:BUILDER,fetchImpl:ctx.fetchImpl,
    goalId:"goal-test-123",
  });
  assert.equal(r.status,"READONLY_CONNECTION_CONFIRMED");
  assert.equal(r.brokerAuthenticated,true);
  assert.equal(r.builderAuthenticated,true);
  assert.equal(r.builderIdentity,"zbook");
  assert.equal(r.goalWorkRunObserved,true);
  assert.equal(r.goalWorkRunPhase,"RUNNING");
  assert.equal(r.builderAcknowledged,false);
  assert.equal(r.actualTaskId,null);
  assert.equal(r.actualBuilderReceiptId,null);
  assert.equal(r.writeAuthorized,false);
  assert.equal(r.mergeAuthorized,false);
  assert.deepEqual(ctx.calls.map(x=>x.url),[
    "http://127.0.0.1:8787/health",
    "http://127.0.0.1:8787/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe",
    "http://127.0.0.1:8796/health",
    "http://127.0.0.1:8787/api/jarvis/admin/work/goal-test-123"
  ]);
  assert.ok(ctx.calls.every(x=>x.options.method==="GET"&&x.options.redirect==="error"));
  assert.ok(ctx.calls.every(x=>x.url.startsWith("http://127.0.0.1:")));
  assert.equal(ctx.calls[0].options.headers.Authorization,"Bearer "+OWNER);
  assert.equal(ctx.calls[1].options.headers.Authorization,"Bearer "+OWNER);
  assert.equal(ctx.calls[2].options.headers.Authorization,"Bearer "+BUILDER);
  assert.doesNotMatch(JSON.stringify(r),/fixture_only_/);
});
test("refuses remote URLs, external redirects, token in URL, or arbitrary goal path",async()=>{
  const ctx=fixture();
  const requests=[
    {brokerUrl:"https://evil.example:8787"},
    {builderUrl:"http://localhost:8796"},
    {brokerUrl:"http://127.0.0.1:8787/?token=xx"},
    {brokerUrl:"http://owner:pass@127.0.0.1:8787/"},
    {goalId:"../../other-goal"},
    {goalId:"goal-test-123/../other"},
    {goalId:"../api/jarvis/admin/tasks"},
  ];
  for(const altered of requests){
    const r=await probeLiveGoriqConnection({
      ownerToken:OWNER,builderToken:BUILDER,fetchImpl:ctx.fetchImpl,...altered,
    });
    assert.equal(r.status,"HOLD");
    assert.equal(r.builderAcknowledged,false);
  }
  assert.equal(ctx.calls.length,0);
});
test("owner's public Broker health alone is not authentication",async()=>{
  const c=fixture({failPath:"/api/jarvis/admin/bridge/events?"});
  const out=await probeLiveGoriqConnection({
    ownerToken:OWNER,builderToken:BUILDER,fetchImpl:c.fetchImpl,
  });
  assert.equal(out.status,"HOLD");
  assert.equal(out.reason,"OWNER_AUTHENTICATION_NOT_VERIFIED");
  assert.equal(out.brokerAuthenticated,false);
  assert.equal(c.calls.length,2);
});
test("no credentials or inaccessible host fail closed without leaking private values",async()=>{
  const bad=await probeLiveGoriqConnection({
    ownerToken:undefined,builderToken:BUILDER,
  });
  assert.equal(bad.reason,"EXISTING_SCOPED_CREDENTIALS_REQUIRED");
  const ctx=fixture({failPath:"/api/jarvis/admin/work/"});
  const result=await probeLiveGoriqConnection({
    ownerToken:OWNER,builderToken:BUILDER,fetchImpl:ctx.fetchImpl,
    goalId:"goal-test-123",
  });
  assert.equal(result.status,"HOLD");
  assert.equal(result.reason,"GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND");
  assert.doesNotMatch(JSON.stringify(result),/fixture_only_/);
  const unreachable=await probeLiveGoriqConnection({
    ownerToken:OWNER,builderToken:BUILDER,
    fetchImpl:async()=>{throw Error("secret private host error");},
  });
  assert.equal(unreachable.reason,"BROKER_NOT_REACHABLE_OR_AUTHENTICATED");
  assert.doesNotMatch(JSON.stringify(unreachable),/secret private host/);
});
test("rejects untrusted service identity and non-builder capabilities",async()=>{
  for(const settings of [
    {brokerPayload:{ok:true,service:"rogue-broker"}},
    {builderPayload:{...builder,capabilities:["filesystem"]}},
    {builderPayload:{...builder,service:"not-a-builder"}},
  ]){
    const c=fixture(settings);
    const out=await probeLiveGoriqConnection({
      ownerToken:OWNER,builderToken:BUILDER,fetchImpl:c.fetchImpl,
    });
    assert.equal(out.status,"HOLD");
    assert.equal(out.builderAcknowledged,false);
  }
});
test("even COMPLETED Goal Work Run is not proof of a Builder receipt",async()=>{
  const c=fixture({runPhase:"COMPLETED"});
  const out=await probeLiveGoriqConnection({
    ownerToken:OWNER,builderToken:BUILDER,fetchImpl:c.fetchImpl,goalId:"goal-test-123",
  });
  assert.equal(out.status,"READONLY_CONNECTION_CONFIRMED");
  assert.equal(out.goalWorkRunPhase,"COMPLETED");
  assert.equal(out.builderAcknowledged,false);
  assert.equal(out.completionClaim,false);
});

test("read-only separately authenticated host checks allow disjoint Mac Broker and ZBook Builder",async()=>{
  const brokerCtx=fixture();
  const m=await probeLiveGoriqConnection({
    mode:"broker",ownerToken:OWNER,fetchImpl:brokerCtx.fetchImpl,
    goalId:"goal-test-123",
  });
  assert.equal(m.status,"BROKER_AUTHENTICATED_READONLY");
  assert.equal(m.brokerAuthenticated,true);
  assert.equal(m.builderAuthenticated,false);
  assert.equal(m.goalWorkRunObserved,true);
  assert.equal(m.builderAcknowledged,false);
  assert.equal(m.actualTaskId,null);
  assert.deepEqual(brokerCtx.calls.map(x=>x.url),[
    "http://127.0.0.1:8787/health",
    "http://127.0.0.1:8787/api/jarvis/admin/bridge/events?goalId=ai09-connection-probe",
    "http://127.0.0.1:8787/api/jarvis/admin/work/goal-test-123"
  ]);

  const builderCtx=fixture();
  const b=await probeLiveGoriqConnection({
    mode:"builder",builderToken:BUILDER,fetchImpl:builderCtx.fetchImpl,
  });
  assert.equal(b.status,"BUILDER_AUTHENTICATED_READONLY");
  assert.equal(b.brokerAuthenticated,false);
  assert.equal(b.builderAuthenticated,true);
  assert.equal(b.builderIdentity,"zbook");
  assert.equal(b.builderAcknowledged,false);
  assert.deepEqual(builderCtx.calls.map(x=>x.url),["http://127.0.0.1:8796/health"]);
  assert.equal(builderCtx.calls[0].options.headers.Authorization,"Bearer "+BUILDER);
});
test("single-host mode never forges cross-host authentication or creates Builder receipt",async()=>{
  const c=fixture();
  for(const request of [
    {mode:"administrator",ownerToken:OWNER,builderToken:BUILDER},
    {mode:"builder",builderToken:BUILDER,goalId:"goal-test-123"},
    {mode:"broker",ownerToken:undefined},
    {mode:"builder",builderToken:undefined}
  ]){
    const x=await probeLiveGoriqConnection({...request,fetchImpl:c.fetchImpl});
    assert.equal(x.status,"HOLD");
    assert.equal(x.builderAcknowledged,false);
  }
  assert.equal(c.calls.length,0);
});

test("trusted-main-only owner-probe workflow never grants write scopes",()=>{
  const workflow=readFileSync(".github/workflows/goriq-ai09-owner-builder-connect.yml","utf8");
  assert.match(workflow,/github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(workflow,/github\.event\.sender\.login == github\.repository_owner/);
  assert.match(workflow,/ref: main/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/runs-on: \[self-hosted, macOS, ARM64\]/);
  assert.match(workflow,/runs-on: \[self-hosted, Windows, X64\]/);
  assert.equal((workflow.match(/permissions:\n\s+contents: read/g)||[]).length,3);
  assert.doesNotMatch(workflow,/pull_request_target|pull_request:\s|repository_dispatch|contents: write|issues: write|id-token: write|pull-requests: write/);
  assert.doesNotMatch(workflow,/\/build|\/api\/jarvis\/admin\/tasks|Remove-Item\s+\$[A-Za-z]+Workspace/);
  const script=readFileSync("scripts/goriq-ai09-live-broker-builder-probe.mjs","utf8");
  assert.doesNotMatch(script,/method:"POST"|execSync|spawn\(/);
  assert.match(script,/OWNER_AUTHENTICATION_NOT_VERIFIED/);
  assert.match(script,/builderAcknowledged:false/);
});

test("ZBook failure diagnosis records only safe availability and does not alter host state",()=>{
  const workflow=readFileSync(".github/workflows/goriq-ai09-owner-builder-connect.yml","utf8");
  const marker="      - name: Diagnose existing local Builder availability without mutation";
  const i=workflow.indexOf(marker);
  assert.ok(i>0);
  const block=workflow.slice(i);
  assert.match(block,/if: failure\(\)/);
  assert.match(block,/shell: powershell/);
  assert.match(block,/Get-NetTCPConnection -LocalPort 8796 -State Listen/);
  assert.match(block,/tokenFilePresent = \[bool\]\$tokenPresent/);
  assert.match(block,/loopbackBound = \[bool\]\$loopbackBound/);
  assert.match(block,/authenticatedHealthStatus = \$healthStatus/);
  assert.match(block,/AI09_ZBOOK_BUILDER_DIAGNOSTIC=/);
  assert.match(block,/\$request.Method = 'GET'/);
  assert.match(block,/AllowAutoRedirect = \$false/);
  assert.match(block,/builderTaskAcknowledged = \$false/);
  assert.match(block,/serviceStartedOrModified = \$false/);
  assert.doesNotMatch(block,/Start-Process|Restart-Service|New-Service|Install-|Remove-Item|Set-Content|Out-File|Invoke-RestMethod|POST|PATCH|PUT/);
  assert.doesNotMatch(block,/Write-Host \(\$token|Write-Host \(\$env:CODE_BUILDER_LOCAL_TOKEN/);
});

test("Task Scheduler metadata can be inspected without starting Builder or exposing launcher contents",()=>{
  const wf=readFileSync(".github/workflows/goriq-ai09-owner-builder-connect.yml","utf8");
  const marker="      - name: Diagnose existing local Builder availability without mutation";
  const index=wf.indexOf(marker);
  assert.ok(index>=0);
  const block=wf.slice(index);
  assert.match(block,/Get-ScheduledTask -TaskName \$taskName -ErrorAction Stop/);
  assert.match(block,/Get-ScheduledTaskInfo -TaskName \$taskName -ErrorAction Stop/);
  assert.match(block,/scheduledTaskState = \$taskState/);
  assert.match(block,/scheduledTaskLastResult = \$taskLastResult/);
  assert.match(block,/launcherPresent = \[bool\]\$launcherPresent/);
  assert.match(block,/installedServiceSourcePresent = \[bool\]\$serviceSourcePresent/);
  assert.match(block,/AI09_ZBOOK_BUILDER_DIAGNOSTIC=/);
  assert.doesNotMatch(block,/Start-ScheduledTask|Register-ScheduledTask|Unregister-ScheduledTask|Set-ScheduledTask|Restart-Service|Start-Process|Get-Content\s+.*run-code-builder|Action\.Arguments|Install-.*Builder/);
  assert.doesNotMatch(block,/Get-Content\s+.*worker\.(?:log|stderr\.log)|Write-Host\s+\$token/);
});

test("local startup log diagnosis emits only predefined categories, never raw secrets",()=>{
  const workflow=readFileSync(".github/workflows/goriq-ai09-owner-builder-connect.yml","utf8");
  const step=workflow.split("      - name: Diagnose existing local Builder availability without mutation")[1];
  assert.ok(step);
  assert.match(step,/existingLogErrorClass = \$logErrorClass/);
  assert.match(step,/Get-Content -LiteralPath \$logFile -Tail 80/);
  assert.match(step,/foreach \(\$signature in \$knownSignatures\)/);
  assert.match(step,/MODULE_NOT_FOUND/);
  assert.match(step,/LAUNCHER_COMMAND_NOT_FOUND/);
  assert.match(step,/NODE_TYPESCRIPT_RUNTIME_ERROR/);
  assert.match(step,/LOCAL_BIND_ERROR/);
  assert.match(step,/UNCLASSIFIED_EXISTING_LOG/);
  assert.doesNotMatch(step,/Write-Host.*\$sample|Write-Output.*\$sample|Write-Host.*\$lines|Write-Host.*\$token/);
  assert.doesNotMatch(step,/Start-ScheduledTask|Register-ScheduledTask|Stop-Process|Start-Process|Restart-Service|Invoke-RestMethod|CODE_BUILDER_TOKEN\s*=\s*\$token/);
});


test("installed task identity and service checksum are read-only booleans",()=>{
  const workflow=readFileSync(".github/workflows/goriq-ai09-owner-builder-connect.yml","utf8");
  const block=workflow.split("      - name: Diagnose existing local Builder availability without mutation")[1];
  assert.ok(block);
  assert.match(block,/nodeAvailableOnRunnerPath = \[bool\]\$nodeOnRunnerPath/);
  assert.match(block,/installedPolicyPresent = \[bool\]\$policyPresent/);
  assert.match(block,/existingTaskExecutableIsPowerShell = \[bool\]\$taskActionUsesPowerShell/);
  assert.match(block,/installedServiceEqualsCurrentMain = \[bool\]\$serviceMatchesTrustedMain/);
  assert.match(block,/lastTaskRunWithinTenMinutes = \[bool\]\$lastTaskRunWithinTenMinutes/);
  assert.match(block,/Get-FileHash -LiteralPath .* -Algorithm SHA256/);
  assert.match(block,/Get-ScheduledTask -TaskName \$taskName/);
  assert.doesNotMatch(block,/Start-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|Start-Process|Stop-Process|Restart-Service|Set-Content|Out-File/);
  assert.doesNotMatch(block,/Write-Host.*\$taskAction|Write-Host.*\$token|Write-Host.*\$launcher|Get-Content\s+.*run-code-builder/);
  assert.doesNotMatch(block,/Action\.Arguments|\$taskAction\.Arguments/);
});
