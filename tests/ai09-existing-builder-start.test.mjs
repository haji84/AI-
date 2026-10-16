import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/goriq-ai09-existing-builder-start.yml","utf8");

test("existing Builder start is a separate owner-trigger-only trusted-main workflow",()=>{
  assert.match(workflow,/name: GORIQ AI-09 One-Shot Existing Builder Start/);
  assert.match(workflow,/github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(workflow,/github\.event\.sender\.login == github\.repository_owner/);
  assert.match(workflow,/startsWith\(github\.event\.issue\.title, '\[AI09 ONE-SHOT BUILDER START\]'\)/);
  assert.match(workflow,/runs-on: \[self-hosted, Windows, X64\]/);
  assert.match(workflow,/ref: main/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/git rev-parse origin\/main/);
  assert.equal((workflow.match(/permissions:\s*\n\s*contents: read/g)||[]).length,2);
  assert.doesNotMatch(workflow,/pull_request_target|repository_dispatch|workflow_dispatch|contents: write|pull-requests: write|issues: write|id-token: write/);
});
test("only one existing scheduled task may be triggered, never reinstalled or rotated",()=>{
  const calls=workflow.match(/^\s+Start-ScheduledTask -TaskName \$taskName/gm)||[];
  assert.equal(calls.length,1);
  assert.match(workflow,/\$taskName = 'GAI Code Builder Worker'/);
  assert.match(workflow,/\$task.State -ne 'Ready'/);
  assert.match(workflow,/Get-ScheduledTask -TaskName \$taskName/);
  assert.match(workflow,/AI09_UNTRUSTED_EXISTING_TASK_ACTION/);
  assert.match(workflow,/run-code-builder\.ps1/);
  assert.match(workflow,/code-builder-worker-service\.ts/);
  assert.match(workflow,/token\.txt/);
  assert.doesNotMatch(workflow,/Register-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|New-ScheduledTaskAction|install-code-builder-windows|Stop-Process|Remove-Item|Stop-ScheduledTask|Set-Content|Out-File|Start-Process/);
});
test("only authenticated loopback Builder health is checked, no task receipt is claimed",()=>{
  assert.match(workflow,/Get-NetTCPConnection -LocalPort 8796 -State Listen/);
  assert.match(workflow,/AI09_BUILDER_NON_LOOPBACK_LISTENER/);
  assert.match(workflow,/http:\/\/127\.0\.0\.1:8796\/health/);
  assert.match(workflow,/\$request.Method = 'GET'/);
  assert.match(workflow,/\$request.AllowAutoRedirect = \$false/);
  assert.match(workflow,/AI09_EXISTING_BUILDER_START=/);
  assert.match(workflow,/builderTaskAccepted = \$false/);
  assert.match(workflow,/actualBuilderReceiptId = \$null/);
  assert.match(workflow,/writeOrMergeAuthorized = \$false/);
  assert.doesNotMatch(workflow,/Invoke-RestMethod.*\/build|\/api\/jarvis\/admin\/work|\/verify|method: POST|method: PATCH|curl .*POST/);
  assert.doesNotMatch(workflow,/Write-Host.*\$token|Write-Host.*\$request|Write-Host.*\$action\.Arguments|Write-Host.*\$launcher/);
});
