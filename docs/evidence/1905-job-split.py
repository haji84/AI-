#!/usr/bin/env python3
"""PR1905 disposable Windows Job differential evidence, never production acceptance."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

REPO = "haji84/AI-"
FIXTURE = Path("tests/owner-code-cutover-peer.fixture.ps1")
TEST = Path("scripts/owner-code-cutover-peer.test.mjs")
SHA_RE = re.compile(r"^[a-f0-9]{40}$")
GROUP_ANCHOR = "Require ($script:ownedPeerJobPipeState -ceq 'CLOSED' -and @($actualPipeHandles|Where-Object {-not $_.IsClosed}).Count -eq 0 -and $fakeStream.CanWrite) 'JOB_IDEMPOTENCE_USES_ONLY_CANONICAL_ORIGINAL_PIPE_CERT'"
GROUP_TEST = "for(const group of [0,1,2])test("
REAL_TEST = "test('Windows private original-State Job contains held Node helper and manager death while outside control survives'"
FLAGS = (
    "pass", "assignedBeforeHello", "heldNodeExited", "heldHelperExited",
    "outsideControlAlive", "parentDeathContained", "earlyFailureNoHello",
    "inflightCloseContained", "actualWindowsJobApis",
    "testMetadataIsNativeAuthority", "nativeAuthority",
)

def unique(source, old, new):
    if source.count(old) != 1:
        raise ValueError("BOUNDED_SOURCE_ANCHOR_INVALID")
    return source.replace(old, new, 1)

def run_selected(pattern, fixture_text, test_text, progress=False, native_phase=False):
    FIXTURE.write_text(fixture_text, encoding="utf-8")
    TEST.write_text(test_text, encoding="utf-8")
    progress_root = None
    phase_root = None
    run_env = None
    if native_phase:
        phase_root = Path(tempfile.mkdtemp(prefix="pr1905-nested-",dir=os.environ["RUNNER_TEMP"]))
        run_env = os.environ.copy()
        run_env["GORIQ_PR1905_PHASE_DIR"] = str(phase_root)
    if progress:
        progress_root = Path(os.environ["RUNNER_TEMP"])/"pr1905-job2-progress"
        progress_root.mkdir(exist_ok=False)
        run_env = os.environ.copy()
        run_env["GORIQ_PUBLIC_PEER_PROGRESS_DIRECTORY"] = str(progress_root)
    def progress_file_names():
        if progress_root is None: return []
        return sorted(f.name for f in progress_root.iterdir()
                      if re.fullmatch(r"(?:OWNED|CLOSED|PLATFORM)_[012]\.txt",f.name))
    def native_phases():
        if phase_root is None: return {}
        result={}
        for group in ("1","2"):
            f=phase_root/("NESTED_"+group+".txt")
            if f.is_file():
                result[group]=[v for v in f.read_text(encoding="ascii",errors="replace").splitlines()
                               if v in ("BEGIN","CONTEXT_OK","JOB_OPTIONS_OK","NATIVE_READY","INPUT_BEFORE","INPUT_READ_BEGIN","INPUT_LINE","INPUT_NULL","INPUT_BOM","INPUT_NO_BOM","INPUT_OBJECT","INPUT_NONOBJECT","INPUT_JSON_BEGIN","INPUT_JSON_OK","INPUT_FAIL_NO_LINE","INPUT_FAIL_EMPTY","INPUT_FAIL_PARSE","INPUT_FAIL_OTHER","INPUT_READY","BEFORE_BASE","AFTER_BASE","TRAP","BASE_FAIL")][-20:]
        return result
    def phases():
        if progress_root is None: return []
        f = progress_root/"OWNED_2.txt"
        if not f.is_file(): return []
        allowed = re.compile(
            r"(?:GROUP_(?:BEGIN|DONE)|SOURCE_BASE_(?:BEGIN|DONE)|CASE_SUCCESS_(?:BEGIN|KERNEL_DONE|SOURCE_DONE|NODE_DONE|CONFIGURATION_DONE|JOURNAL_DONE|FALLBACK_DONE|PEER_DONE|END)):[0-9]{1,9}")
        return [v for v in f.read_text(encoding="utf-8", errors="replace").splitlines()
                if allowed.fullmatch(v)][-24:]
    try:
        cp = subprocess.run(
            ["node", "--test", "--test-concurrency=1",
             "--test-name-pattern=" + pattern, str(TEST)],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=48, check=False, env=run_env,
        )
        return {"status": "RETURNED", "exit": cp.returncode,
                "stdout": cp.stdout, "stderr": cp.stderr, "progress": phases(), "progress_files":progress_file_names(),"nested_phases":native_phases()}
    except subprocess.TimeoutExpired:
        return {"status": "DIAGNOSTIC_TIMEOUT", "exit": None,
                "stdout": "", "stderr": "", "progress": phases(), "progress_files":progress_file_names(),"nested_phases":native_phases()}
    finally:
        if phase_root is not None:
            shutil.rmtree(phase_root,ignore_errors=True)

def group2_diagnostic(fixture, test):
    if "OwnedJobCase" in fixture:
        # The current full test preserves all six cases as six separately
        # bounded processes. Emit only whitelisted mode and exit classifications.
        start=test.index(GROUP_TEST)
        end=test.index("\ntest(",start+len(GROUP_TEST))
        chunk=test[start:end]
        chunk=unique(chunk,"const selected=spawnSync(shell,args,",
                     "console.log('JOB_CASE_BEGIN '+mode);const selected=spawnSync(shell,args,")
        chunk=unique(chunk,"assert.equal(selected.error,undefined);",
                     "console.log('JOB_CASE_RUNTIME '+mode+'|'+(selected.error?.code==='ETIMEDOUT'?'TIMEOUT':selected.status===0?'ZERO':selected.status===null?'NULL':'NONZERO'));assert.equal(selected.error,undefined);")
        chunk=unique(chunk,"verified.add(mode);",
                     "verified.add(mode);console.log('JOB_CASE_OK '+mode);")
        cp=run_selected(
            "^private original-State owned Job finite policy and cleanup group2 is DATA only$",
            fixture,test[:start]+chunk+test[end:])
        flags=re.findall(r"JOB_CASE_(?:BEGIN|OK) (?:assigned-close|assign-fail|create-unknown|close-fail|mirror-cleanup|duplicate-close)|JOB_CASE_RUNTIME (?:assigned-close|assign-fail|create-unknown|close-fail|mirror-cleanup|duplicate-close)\|(?:ZERO|NULL|NONZERO|TIMEOUT)",cp["stdout"])
        return {"run_status":cp["status"],"original_assertions_exit":cp["exit"],
                "case_progress":flags[-18:],
                "six_original_cases_required":True,"acceptance":"NOT_ASSESSED"}
    fixed = """
[Console]::Error.WriteLine('JOB_GROUP2_STATE|'+$(if($script:ownedPeerJobPipeState -ceq 'CLOSED'){'YES'}else{'NO'}));
[Console]::Error.WriteLine('JOB_GROUP2_PIPES|'+$(if(@($actualPipeHandles|Where-Object {-not $_.IsClosed}).Count -eq 0){'YES'}else{'NO'}));
[Console]::Error.WriteLine('JOB_GROUP2_FAKE|'+$(if($fakeStream.CanWrite){'YES'}else{'NO'}));
[Console]::Error.WriteLine('JOB_GROUP2_OWNER|'+$(if($null -ne (Get-OwnerCutoverOwnedPeerJobCleanupOwner)){'YES'}else{'NO'}));
$g2Cert=Microsoft.PowerShell.Utility\\Get-Variable -Name ownedPeerJobCanonicalPipes -Scope Script -ErrorAction SilentlyContinue;
[Console]::Error.WriteLine('JOB_GROUP2_CANONICAL|'+$(if($g2Cert -and ($g2Cert.Options -band [Management.Automation.ScopedItemOptions]::Constant)){'YES'}else{'NO'}));
[Console]::Error.WriteLine('JOB_GROUP2_ATTEMPTS|'+$(if($owner.CloseAttempts -eq 1){'YES'}else{'NO'}));
"""
    modified_fixture = unique(fixture, GROUP_ANCHOR, fixed + GROUP_ANCHOR)
    start = test.index(GROUP_TEST)
    end = test.index("\ntest(", start + len(GROUP_TEST))
    chunk = test[start:end]
    before = "assert.equal(child.error,undefined);assert.equal(child.status,0"
    capture = r"""if(group===2){const fixed=(child.stderr||'').split(/\r?\n/).filter(line=>/^JOB_GROUP2_(?:STATE|PIPES|FAKE|OWNER|CANONICAL|ATTEMPTS)\|(?:YES|NO)$/.test(line));console.log('JOB_GROUP2_FLAGS '+JSON.stringify(fixed.slice(-12)));console.log('JOB_GROUP2_TIMEOUT '+(child.error?.code==='ETIMEDOUT'?'YES':'NO'));}"""
    chunk = unique(chunk, before, capture + before)
    modified_test = test[:start] + chunk + test[end:]
    cp = run_selected(
        "^private original-State owned Job finite policy and cleanup group2 is DATA only$",
        modified_fixture, modified_test, progress=True,
    )
    found = re.findall(r"JOB_GROUP2_FLAGS (\[[^\r\n]{1,800}\])", cp["stdout"])
    vals = json.loads(found[-1]) if found else []
    timeout = re.findall(r"JOB_GROUP2_TIMEOUT (YES|NO)", cp["stdout"])
    # The original JS test's after-hook prints the bounded fixture progress
    # *before* it deletes its own temporary directory. The Python caller
    # must parse that public receipt, not its externally supplied env dir.
    observed = re.findall(r"GORIQ_PUBLIC_PEER_PROGRESS (\[[^\r\n]{1,20000}\])", cp["stdout"])
    phase_rows = []
    for payload in observed[-2:]:
        try:
            for item in json.loads(payload):
                if not isinstance(item,dict) or item.get("group") != "OWNED_2":
                    continue
                for v in item.get("rows",[])[:64]:
                    if isinstance(v,str) and re.fullmatch(
                      r"(?:GROUP_(?:BEGIN|DONE)|SOURCE_BASE_(?:BEGIN|DONE)|CASE_SUCCESS_(?:BEGIN|KERNEL_DONE|SOURCE_DONE|NODE_DONE|CONFIGURATION_DONE|JOURNAL_DONE|FALLBACK_DONE|PEER_DONE|END)):[0-9]{1,9}",v):
                        phase_rows.append(v)
        except (TypeError,ValueError):
            pass
    phases = []
    for item in vals:
        if isinstance(item, str) and re.fullmatch(
            r"JOB_GROUP2_(?:STATE|PIPES|FAKE|OWNER|CANONICAL|ATTEMPTS)\|(?:YES|NO)", item
        ):
            phases.append(item)
    return {"run_status": cp["status"], "original_assertions_exit": cp["exit"],
            "powershell_timeout": timeout[-1] if timeout else "UNKNOWN",
            "predicate_rows": phases, "progress_tail": phase_rows[-24:],
            "case_begin_count":sum(x.startswith("CASE_SUCCESS_BEGIN:") for x in phase_rows),
            "progress_files":cp.get("progress_files", []),
            "acceptance": "NOT_ASSESSED"}

def group2_single_case_diagnostics(fixture, test):
    if "OwnedJobCase" in fixture:
        # The CURRENT original group2 test already executes all six bounded
        # cases independently; don't multiply six by six in diagnostics.
        return {"status":"SOURCE_BOUND_ORIGINAL_SIX_CASES", "acceptance":"NOT_ASSESSED"}
    """One case per disposable process, original 15s per-process clock retained.

    The original six-row assertion intentionally FAILS for a one-row experiment.
    This is never a replacement for or PASS of the six-case group2 test.
    """
    modes = ("assigned-close", "assign-fail", "create-unknown",
             "close-fail", "mirror-cleanup", "duplicate-close")
    group = "@('assigned-close','assign-fail','create-unknown','close-fail','mirror-cleanup','duplicate-close')"
    if fixture.count(group) != 1:
        raise ValueError("GROUP2_SOURCE_SHAPE_CHANGED")
    start = test.index(GROUP_TEST)
    end = test.index("\ntest(", start + len(GROUP_TEST))
    chunk = test[start:end]
    anchor = "assert.equal(child.error,undefined);assert.equal(child.status,0"
    capture = """if(group===2){let accepted=false,number=0;
try{const v=JSON.parse(child.stdout);number=Array.isArray(v.rows)?v.rows.length:0;
accepted=number===1&&v.rows[0]?.pass===true&&v.rows[0]?.id===process.env.GORIQ_SUBCASE;}catch{}
console.log('JOB_SUBCASE_OBS '+JSON.stringify({timeout:child.error?.code==='ETIMEDOUT',
exit:child.status===0?'ZERO':child.status===null?'NULL':'NONZERO',
oneCase:accepted,rows:number,stderr:child.stderr?.length>0}));}"""
    one_test = test[:start] + unique(chunk, anchor, capture + anchor) + test[end:]
    cases=[]
    for name in modes:
        altered=fixture.replace(group, "@('" + name + "')")
        os.environ["GORIQ_SUBCASE"] = name
        import time
        started=time.monotonic()
        cp=run_selected(
            "^private original-State owned Job finite policy and cleanup group2 is DATA only$",
            altered, one_test,
        )
        elapsed=round(time.monotonic()-started,2)
        observations=re.findall(r"JOB_SUBCASE_OBS (\{[^\r\n]{1,350}\})", cp["stdout"])
        obj=json.loads(observations[-1]) if observations else {}
        cases.append({"case":name, "elapsed_seconds":elapsed,
                      "diagnostic_process_exit":cp["exit"],
                      "timeout":obj.get("timeout",None),
                      "inner_exit":obj.get("exit","UNKNOWN"),
                      "one_case_completed":obj.get("oneCase",False),
                      "rows":obj.get("rows",None),
                      "stderr_nonempty":obj.get("stderr",None)})
    os.environ.pop("GORIQ_SUBCASE",None)
    return {"cases":cases, "replaces_original_tests":False,
            "acceptance":"NOT_ASSESSED"}


def real_windows_diagnostic(fixture, test, explicit_driver_target=False, bom_trim=False, outside_utf8=False, async_stdout=False):
    start = test.index(REAL_TEST)
    end = test.index("\ntest(", start + len(REAL_TEST))
    chunk = test[start:end]
    anchor = "const r=JSON.parse(child.stdout);assert.equal(r.pass,true);"
    fields = json.dumps(list(FLAGS), separators=(",", ":"))
    before = ("const r=JSON.parse(child.stdout);"
              "const publicKeys=" + fields + ";"
              "console.log('JOB_REAL_FLAGS '+JSON.stringify("
              "Object.fromEntries(publicKeys.map(k=>[k,r[k]===true?'YES':"
              "r[k]===false?'NO':'UNKNOWN']))));"
              "assert.equal(r.pass,true);")
    chunk = unique(chunk, anchor, before)
    # The original case may reject before JSON parsing. Expose only the
    # original public/closed fixture reason code, never paths or raw stderr.
    fixtureCatch = "}catch{$script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}}"
    fixtureProbe = """}catch{
 $reason='UNKNOWN';$value=[string]$_.Exception.GetBaseException().Message
 $tag=[regex]::Match($value,'(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100}');if($tag.Success){$reason=$tag.Value}
 if($script:publicJobReadStage -ceq 'OUTSIDE' -and $outside){
  $alive=$true
  try{$alive=-not $outside.HasExited;if($alive){$null=$outside.WaitForExit(300);$alive=-not $outside.HasExited}}catch{}
  [Console]::Error.WriteLine('JOB_OUTSIDE_EXITED|'+$(if($alive){'NO'}else{'YES'}))
  if(-not $alive){
   $code='NONZERO'
   try{if($outside.ExitCode -eq 0){$code='ZERO'}}catch{$code='UNKNOWN'}
   [Console]::Error.WriteLine('JOB_OUTSIDE_EXIT_CODE|'+$code)
   $raw=''
   try{$raw=$outside.StandardError.ReadToEnd()}catch{}
   $class='OTHER'
   if([string]::IsNullOrEmpty($raw)){$class='EMPTY'}
   elseif($raw -match 'PUBLIC_HELPER_READY_TIMEOUT'){$class='HELPER_TIMEOUT'}
   elseif($raw -match 'PUBLIC_HELPER_READY_SHAPE'){$class='HELPER_SHAPE'}
   elseif($raw -match 'PUBLIC_HELPER_READY_LIMIT'){$class='HELPER_LIMIT'}
   elseif($raw -match 'PUBLIC_HELPER_SELF_BINDING'){$class='HELPER_IDENTITY'}
   elseif($raw -match 'PUBLIC_HELPER_READY_REFUSED'){$class='HELPER_REFUSED'}
   elseif($raw -match '(?i)SyntaxError|Unexpected token|JSON\.parse'){$class='JSON_SYNTAX'}
   elseif($raw -match '(?i)ERR_MODULE_NOT_FOUND|Cannot find module'){$class='MODULE_NOT_FOUND'}
   elseif($raw -match '(?i)ReferenceError'){$class='REFERENCE_ERROR'}
   elseif($raw -match '(?i)TypeError'){$class='TYPE_ERROR'}
   elseif($raw -match '(?i)EPIPE|broken pipe'){$class='BROKEN_PIPE'}
   elseif($raw -match '(?i)ENOENT|not found'){$class='FILE_MISSING'}
   elseif($raw -match '(?i)ERR_INVALID'){$class='NODE_INVALID'}
   elseif($raw -match '(?i)Error|Exception'){$class='NODE_ERROR'}
   [Console]::Error.WriteLine('JOB_OUTSIDE_ERROR_CLASS|'+$class)
  }
 }
 if($script:publicJobReadStage -ceq 'OUTSIDE' -and $outside){
  try{
   $path=[IO.Path]::Combine($owned,('public-node-'+$outside.Id+'.phases'))
   if([IO.File]::Exists($path)){
    $stages=[IO.File]::ReadAllLines($path,[Text.Encoding]::ASCII)
    foreach($stage in $stages){
     if($stage -cin @('INPUT_BEGIN','JSON_OK','HELPER_BEGIN','HELPER_READY','OUTPUT_BEGIN','OUTPUT_SENT','OUTPUT_FAIL')){
      [Console]::Error.WriteLine('JOB_OUTSIDE_PHASE|'+$stage)
     }
    }
   }
  }catch{}
 }
 [Console]::Error.WriteLine('JOB_REAL_STAGE|'+$reason)
 $script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}
}"""
    # Only in the disposable Job differential: stage the outside Node peer
    # without logging the JSON wire, identities, paths or exception messages.
    # The original native authority and all original acceptance tests stay intact.
    nodePhase=r"""
 if($OwnedJobWindows){
  $js="import{appendFileSync}from'node:fs';function jobPhase(x){try{appendFileSync('public-node-'+process.pid+'.phases',x+'\n',{encoding:'ascii',flag:'a'});}catch{}}"+$js
  $js=$js.Replace("const h=JSON.parse(first.replace(/^\uFEFF/,''));","jobPhase('INPUT_BEGIN');const h=JSON.parse(first.replace(/^\uFEFF/,''));jobPhase('JSON_OK');")
  $js=$js.Replace("const publicJobBirth=await new Promise","jobPhase('HELPER_BEGIN');const publicJobBirth=await new Promise")
  $js=$js.Replace("ancestry.helper.pid=publicJobHelper.pid;","jobPhase('HELPER_READY');ancestry.helper.pid=publicJobHelper.pid;")
  $js=$js.Replace("writePublicStdout(wire+'\n'+","jobPhase('OUTPUT_BEGIN');writePublicStdout(wire+'\n'+")
  $js=$js.Replace("writePublicStdout(wire+'\n'+(mode==='extra'?'PUBLIC_EXTRA_FRAME\n':''));});",
    "try{writePublicStdout(wire+'\n'+(mode==='extra'?'PUBLIC_EXTRA_FRAME\n':''));jobPhase('OUTPUT_SENT')}catch(e){jobPhase('OUTPUT_FAIL');throw e};});")
 }
"""
    modified_fixture=unique(fixture,
       " [IO.File]::WriteAllText($childPath,$js,[Text.UTF8Encoding]::new($false));",
       nodePhase+" [IO.File]::WriteAllText($childPath,$js,[Text.UTF8Encoding]::new($false));")
    if async_stdout:
        synchronous="function writePublicStdout(text){const bytes=Buffer.from(text,'utf8');let offset=0;while(offset<bytes.length){const count=writeSync(1,bytes,offset,bytes.length-offset);if(!Number.isInteger(count)||count<1||count>bytes.length-offset)throw new Error('PUBLIC_FD_WRITE_REFUSED');offset+=count;}}"
        modified_fixture=unique(modified_fixture,synchronous,
            "function writePublicStdout(text){process.stdout.write(text,'utf8');}")
    if outside_utf8:
        marker="$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=[string]$inputData.nodeExecutable;"
        begin=modified_fixture.index(marker)
        end=modified_fixture.index("$outside=[Diagnostics.Process]::new();",begin)
        section=modified_fixture[begin:end]
        section=unique(section,
           "$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true",
           "$info.RedirectStandardInput=$true;$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false);Require ($info.StandardInputEncoding.GetPreamble().Length -eq 0) 'JOB_OUTSIDE_UTF8_NO_BOM';$info.RedirectStandardOutput=$true")
        modified_fixture=modified_fixture[:begin]+section+modified_fixture[end:]
    # Read-only hosted diagnostic: classify whether the original Reader's
    # first read failed or a previously consumed JSON frame lacked newline.
    originalRead="Require ($task.GetAwaiter().GetResult() -eq 1) 'JOB_PRIVATE_LINE_PARTIAL'"
    instrumentedRead="""$got=$task.GetAwaiter().GetResult()
 if($got -ne 1){
  $size=if($count -eq 0){'ZERO'}elseif($count -lt 256){'SHORT'}elseif($count -lt 4096){'MEDIUM'}else{'LONG'}
  $first=if($count -eq 0){'EMPTY'}elseif($buffer[0] -eq '{'){'OBJECT'}elseif($buffer[0] -eq [char]0xFEFF){'BOM'}else{'OTHER'}
  [Console]::Error.WriteLine('JOB_READER_COUNT|'+$size)
  [Console]::Error.WriteLine('JOB_READER_PREFIX|'+$first)
 }
 Require ($got -eq 1) 'JOB_PRIVATE_LINE_PARTIAL'"""
    modified_fixture=unique(modified_fixture,originalRead,instrumentedRead)
    modified_fixture = unique(modified_fixture, fixtureCatch, fixtureProbe)
    # Phase labels in disposable fixture, no change to original guards.
    modified_fixture=unique(modified_fixture,"    Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper\n    # Caller-invoked lost-budget refusal","    Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper\n    [Console]::Error.WriteLine('JOB_REAL_PHASE|OUTSIDE_HELD')\n    # Caller-invoked lost-budget refusal")
    modified_fixture=unique(modified_fixture,"    Expire-PublicOwnedJobDataClock;$refused=$false;try{&$module {Assert-OwnerCutoverOwnedPeer}}catch{$refused=$true};Require $refused 'JOB_INFLIGHT_ORIGINAL_CLOCK_REFUSAL'","    Expire-PublicOwnedJobDataClock;$refused=$false;try{&$module {Assert-OwnerCutoverOwnedPeer}}catch{$refused=$true};Require $refused 'JOB_INFLIGHT_ORIGINAL_CLOCK_REFUSAL';[Console]::Error.WriteLine('JOB_REAL_PHASE|CLOCK_REFUSED')")
    modified_fixture=unique(modified_fixture,"    Wait-PublicPrivateJobHeldExit $heldNode;Wait-PublicPrivateJobHeldExit $heldHelper;Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper;Require ($owner.CloseEntered -and $owner.CloseReturned -and $owner.CloseConfirmed) 'JOB_NATIVE_CLOSE_RETURN_CONFIRMED'","    Wait-PublicPrivateJobHeldExit $heldNode;Wait-PublicPrivateJobHeldExit $heldHelper;Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper;Require ($owner.CloseEntered -and $owner.CloseReturned -and $owner.CloseConfirmed) 'JOB_NATIVE_CLOSE_RETURN_CONFIRMED';[Console]::Error.WriteLine('JOB_REAL_PHASE|ORIGINAL_CLOSED')")
    modified_fixture=unique(modified_fixture,"    $earlyDriver=New-PublicPrivateJobDriver 2 $publicInput","    [Console]::Error.WriteLine('JOB_REAL_PHASE|EARLY_START');$earlyDriver=New-PublicPrivateJobDriver 2 $publicInput")
    modified_fixture=unique(modified_fixture,"    $driver=New-PublicPrivateJobDriver 1 $publicInput;","    [Console]::Error.WriteLine('JOB_REAL_PHASE|MANAGER_START');$driver=New-PublicPrivateJobDriver 1 $publicInput;[Console]::Error.WriteLine('JOB_REAL_PHASE|MANAGER_RESPONSE');")
    modified_fixture=unique(modified_fixture,"    Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper\n    $script:jobWindowsResult=@{pass=$true","    Assert-PublicPrivateJobHeldAlive $outsideCert;Assert-PublicPrivateJobHeldAlive $outsideHelper\n    [Console]::Error.WriteLine('JOB_REAL_PHASE|FINAL_CHECKED')\n    $script:jobWindowsResult=@{pass=$true")
    # Two distinct read sites. The label is diagnostic state only, not proof
    # that the worker was assigned or that any native Job is valid.
    # The previous public stage label OUTSIDE was stale after early-driver
    # entry. Capture only bounded original driver lifecycle phases.
    # Distinguish a pre-start refusal from a child JSON/pipe failure. Each
    # marker is a fixed enum and exists only in this disposable Windows test.
    checkpoints=[
      ("function New-PublicPrivateJobDriver([int]$Group,[string]$InputJson){",
       "function New-PublicPrivateJobDriver([int]$Group,[string]$InputJson){[Console]::Error.WriteLine('JOB_EARLY_DRIVER|ENTER');"),
      ("Assert-PublicPrivateJobCaseBudget;Require ($Group -in @(1,2)",
       "[Console]::Error.WriteLine('JOB_EARLY_DRIVER|BUDGET_BEFORE');Assert-PublicPrivateJobCaseBudget;[Console]::Error.WriteLine('JOB_EARLY_DRIVER|BUDGET_DONE');Require ($Group -in @(1,2)"),
      ("$p=[Diagnostics.Process]::new();$p.StartInfo=$info;$held=$null",
       "[Console]::Error.WriteLine('JOB_EARLY_DRIVER|STARTINFO_READY');$p=[Diagnostics.Process]::new();$p.StartInfo=$info;$held=$null"),
      ("try{Require ($p.Start()) 'JOB_FIXED_MANAGER_START';",
       "try{[Console]::Error.WriteLine('JOB_EARLY_DRIVER|START_BEFORE');Require ($p.Start()) 'JOB_FIXED_MANAGER_START';[Console]::Error.WriteLine('JOB_EARLY_DRIVER|START_DONE');"),
      ("$stderr=$p.StandardError.ReadAsync($stderrBuffer,0,1);",
       "$stderr=$p.StandardError.ReadAsync($stderrBuffer,0,1);[Console]::Error.WriteLine('JOB_EARLY_DRIVER|STDERR_TASK_READY');"),
    ]
    for original, revised in checkpoints:
        modified_fixture=unique(modified_fixture,original,revised)

    driverInput="$p.StandardInput.WriteLine($InputJson);$p.StandardInput.Flush();"
    modified_fixture=unique(modified_fixture,driverInput,
        "[Console]::Error.WriteLine('JOB_EARLY_DRIVER|WRITE_BEFORE');"+
        driverInput+"[Console]::Error.WriteLine('JOB_EARLY_DRIVER|WRITE_DONE');")
    driverRead="$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;"
    modified_fixture=unique(modified_fixture,driverRead,
        "[Console]::Error.WriteLine('JOB_EARLY_DRIVER|READ_BEFORE');"+
        driverRead+"[Console]::Error.WriteLine('JOB_EARLY_DRIVER|READ_DONE');")
    driverDecode="$data=$line|Microsoft.PowerShell.Utility\\ConvertFrom-Json;"
    modified_fixture=unique(modified_fixture,driverDecode,
        "[Console]::Error.WriteLine('JOB_EARLY_DRIVER|PARSE_BEFORE');"+
        driverDecode+"[Console]::Error.WriteLine('JOB_EARLY_DRIVER|PARSE_DONE');")
    modified_fixture=unique(modified_fixture,
        "$earlyDriver=New-PublicPrivateJobDriver 2 $publicInput",
        "$earlyDriver=New-PublicPrivateJobDriver 2 $publicInput;[Console]::Error.WriteLine('JOB_EARLY_DRIVER|RETURNED')")
    modified_fixture = unique(
        modified_fixture,
        "$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;",
        "$script:publicJobReadStage='DRIVER';$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;")
    modified_fixture = unique(
        modified_fixture,
        "$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;",
        "$script:publicJobReadStage='OUTSIDE';$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;")
    # Confirm whether the original outside line actually completed before
    # attributing a later closed-identity refusal to the line reader.
    modified_fixture=unique(modified_fixture,
       "$script:publicJobReadStage='OUTSIDE';$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;",
       "$script:publicJobReadStage='OUTSIDE';$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;[Console]::Error.WriteLine('JOB_REAL_OUTSIDE_READ|YES');")
    modified_fixture=unique(modified_fixture,
       "$outsideData=$outsideWire|Microsoft.PowerShell.Utility\\ConvertFrom-Json;",
       "$outsideData=$outsideWire|Microsoft.PowerShell.Utility\\ConvertFrom-Json;[Console]::Error.WriteLine('JOB_REAL_OUTSIDE_JSON|YES');")
    modified_fixture=unique(modified_fixture,
       "$outsideHelper=Open-PublicPrivateJobHeldProcess $outsideData.ancestry.helper.pid $outsideData.ancestry.helper.creationTicks $systemPS $outside.Id",
       "$outsideHelper=Open-PublicPrivateJobHeldProcess $outsideData.ancestry.helper.pid $outsideData.ancestry.helper.creationTicks $systemPS $outside.Id;[Console]::Error.WriteLine('JOB_REAL_OUTSIDE_HELPER|YES')")

    modified_fixture = unique(
        modified_fixture,
        "[Console]::Error.WriteLine('JOB_REAL_STAGE|'+$reason)",
        "[Console]::Error.WriteLine('JOB_REAL_STAGE|'+$reason);[Console]::Error.WriteLine('JOB_REAL_READ_CONTEXT|'+$(if($script:publicJobReadStage -cin @('OUTSIDE','DRIVER')){$script:publicJobReadStage}else{'UNKNOWN'}))")
    # The manager driver may terminate before its first JSON line. Only
    # boolean and enum state of the originally allocated child is emitted.
    driverCatch="}catch{if($held){$null=Stop-PublicPrivateJobAllocatedProcess $held};$script:privateJobUnconfirmedDriver=@{process=$p;held=$held;info=$info};throw}"
    driverProbe="""}catch{
 [Console]::Error.WriteLine('JOB_DRIVER_CHILD_EXITED|'+$(if($p.HasExited){'YES'}else{'NO'}))
 $exitKind='UNKNOWN'
 if($p.HasExited){$exitKind=if($p.ExitCode -eq 0){'ZERO'}else{'NONZERO'}}
 [Console]::Error.WriteLine('JOB_DRIVER_EXIT_CODE|'+$exitKind)
 $readKind='PENDING'
 if($stderr -and $stderr.IsCompleted){try{$n=$stderr.GetAwaiter().GetResult();$readKind=if($n -eq 0){'EOF'}else{'DATA'}}catch{$readKind='FAULT'}}
 [Console]::Error.WriteLine('JOB_DRIVER_STDERR_READ|'+$readKind)
 if($p.HasExited){
  $childTail=''
  try{$childTail=$p.StandardError.ReadToEnd()}catch{}
  $allowed=[regex]::Match($childTail,'JOB_DRIVER_TRAP\|((?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100}))')
  [Console]::Error.WriteLine('JOB_DRIVER_TRAP_CAPTURE|'+$(if($allowed.Success){$allowed.Groups[1].Value}else{'UNAVAILABLE'}))
  $bootstrap=[regex]::Match($childTail,'JOB_SOURCE_BASE_FAILURE\|((?:UNKNOWN|(?:CUTOVER_BOOTSTRAP_FIXTURE|CUTOVER|PEER_FIXTURE|ROTATION_CUTOVER|JOB)_[A-Z0-9_]{3,120}))')
  $errclass=[regex]::Match($childTail,'JOB_SOURCE_BASE_CLASS\|((?:RUNTIME|METHOD|ARGUMENT|FORMAT|INVALID_OPERATION|IO|OTHER))')
  [Console]::Error.WriteLine('JOB_DRIVER_SOURCE_BASE|'+$(if($bootstrap.Success){$bootstrap.Groups[1].Value}else{'UNAVAILABLE'}))
  [Console]::Error.WriteLine('JOB_DRIVER_SOURCE_CLASS|'+$(if($errclass.Success){$errclass.Groups[1].Value}else{'UNAVAILABLE'}))
  $inputError=[regex]::Match($childTail,'JOB_DRIVER_INPUT_FAILURE\|(NO_LINE|EMPTY|PARSE|OTHER)')
  [Console]::Error.WriteLine('JOB_DRIVER_INPUT_CODE|'+$(if($inputError.Success){$inputError.Groups[1].Value}else{'UNAVAILABLE'}))
  $class='OTHER'
  if($childTail -match '(?i)ParserError|UnexpectedToken|MissingEndCurlyBrace|TerminatorExpected'){$class='PARSE'}
  elseif($childTail -match '(?i)ParameterBinding|positional parameter|cannot bind argument|cannot convert value'){$class='BIND'}
  elseif($childTail -match '(?i)cannot be loaded|Cannot find path|does not exist|FileNotFoundException'){$class='FILE'}
  elseif($childTail -match '(?i)UnauthorizedAccess|access to the path|AccessDenied|permission denied'){$class='ACCESS'}
  elseif($childTail -match '(?i)CUTOVER_BOOTSTRAP_FIXTURE_'){$class='BOOTSTRAP'}
  elseif($childTail -match '(?i)PEER_FIXTURE_|PUBLIC_PRIVATE_JOB_'){$class='FIXTURE'}
  elseif($childTail -match '(?i)ROTATION_CUTOVER_|ROTATION_ENTRY_'){$class='ROTATION'}
  elseif($childTail -match '(?i)variable.*(not set|cannot be retrieved)|property.*cannot be found'){$class='STRICT'}
  elseif($childTail -match '(?i)Exception|Error'){$class='OTHER_ERROR'}
  [Console]::Error.WriteLine('JOB_DRIVER_ERRCATEGORY|'+$class)
 }
 if($held){$null=Stop-PublicPrivateJobAllocatedProcess $held}
 $script:privateJobUnconfirmedDriver=@{process=$p;held=$held;info=$info};throw
}"""
    modified_fixture = unique(modified_fixture, driverCatch, driverProbe)
    # Differentiate partial EOF caused by a clean exit vs an explicit
    # exception in the independently allocated original driver.
    # Only disposable inner-driver errors are classified. Keep original
    # stderr and nonzero failure, and emit no paths, tokens or exception text.
    trapAnchor="Set-StrictMode -Version Latest\n# BEGIN_COMPOSED_PRIVATE_TEST_MODE"
    trapCode="""Set-StrictMode -Version Latest
trap {
 if($OwnedJobWindows -and $TransportGroup -in @(1,2)){
  $value=[string]$_.Exception.GetBaseException().Message
  $tag='UNKNOWN'
  if($value -cmatch '\A(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100}\z'){$tag=$value}
  [Console]::Error.WriteLine('JOB_DRIVER_TRAP|'+$tag)
 }
 Emit-PublicNestedStage 'TRAP'
 break
}
# BEGIN_COMPOSED_PRIVATE_TEST_MODE"""
    modified_fixture = unique(modified_fixture,trapAnchor,trapCode)
    # Disposable, hosted-Windows-only phase receipt in an isolated temporary
    # directory. Exactly six fixed labels; no raw paths or exception contents.
    stageFunction=r"""
function Emit-PublicNestedStage([string]$Label) {
 if(-not $OwnedJobWindows -or $TransportGroup -notin @(1,2) -or
    $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    [string]::IsNullOrWhiteSpace($env:GORIQ_PR1905_PHASE_DIR)){return}
 if($Label -notin @('BEGIN','CONTEXT_OK','JOB_OPTIONS_OK','NATIVE_READY','INPUT_BEFORE','INPUT_READ_BEGIN','INPUT_LINE','INPUT_NULL','INPUT_BOM','INPUT_NO_BOM','INPUT_OBJECT','INPUT_NONOBJECT','INPUT_JSON_BEGIN','INPUT_JSON_OK','INPUT_FAIL_NO_LINE','INPUT_FAIL_EMPTY','INPUT_FAIL_PARSE','INPUT_FAIL_OTHER','INPUT_READY','BEFORE_BASE','AFTER_BASE','TRAP','BASE_FAIL')){return}
 try{
  $root=$env:GORIQ_PR1905_PHASE_DIR
  if([IO.Directory]::Exists($root)){
   $path=[IO.Path]::Combine($root,('NESTED_'+$TransportGroup+'.txt'))
   [IO.File]::AppendAllText($path,($Label+[char]10),[Text.Encoding]::ASCII)
  }
 }catch{}
}
Emit-PublicNestedStage 'BEGIN'
"""
    modified_fixture = unique(modified_fixture,"# BEGIN_COMPOSED_PRIVATE_TEST_MODE",
        "# BEGIN_COMPOSED_PRIVATE_TEST_MODE\n"+stageFunction)
    # Three fixed checkpoints before the private bootstrap. A blocked startup
    # check is not a Job protocol failure, so no assertion is bypassed.
    modified_fixture = unique(modified_fixture, "# END_COMPOSED_PRIVATE_TEST_MODE",
        "Emit-PublicNestedStage 'CONTEXT_OK'\n# END_COMPOSED_PRIVATE_TEST_MODE")
    modified_fixture = unique(modified_fixture, "# TEST batch selection only;",
        "Emit-PublicNestedStage 'JOB_OPTIONS_OK'\n# TEST batch selection only;")
    nativeLoad=". (Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')"
    # The native source line also occurs inside a separate embedded corpus.
    # Scope the replacement to the real fixture's grouped-clock guard.
    nativeAnchor="if($script:publicClockTransactionGrouped -and $TransportGroup -notin @(0,1)){throw 'PEER_FIXTURE_CLOCK_TRANSACTION_GROUP_REQUIRED'}\n"+nativeLoad
    modified_fixture=unique(modified_fixture,nativeAnchor,
        nativeAnchor+";Emit-PublicNestedStage 'NATIVE_READY'")
    inputLine="$publicInput=if($OwnedJobWindows -and $TransportGroup -in @(1,2))"
    modified_fixture = unique(modified_fixture,inputLine,
        "Emit-PublicNestedStage 'INPUT_BEFORE';"+inputLine)
    # The nested manager was observed to exit between SOURCE_BASE_BEGIN and
    # SOURCE_BASE_DONE. Capture the original failing contract code before the
    # child ends. Strictly bounded fixed enum, not exception text or file data.
    sourceBase="$null=. (Join-Path $Root 'tests/owner-code-cutover-private-bootstrap.fixture.ps1') -Scenario kernel -FixtureInput $publicInput -UseExistingNative75"
    sourceProbe="""try{ORIGINAL_SOURCE_BASE}catch{
 $base=$_.Exception.GetBaseException()
 $message=[string]$base.Message
 $code='UNKNOWN'
 if($message -cmatch '(?:CUTOVER_BOOTSTRAP_FIXTURE|CUTOVER|PEER_FIXTURE|ROTATION_CUTOVER|JOB)_[A-Z0-9_]{3,120}'){$code=$Matches[0]}
 [Console]::Error.WriteLine('JOB_SOURCE_BASE_FAILURE|'+$code)
 $category=switch($base.GetType().Name){
  'RuntimeException'{'RUNTIME'}
  'MethodInvocationException'{'METHOD'}
  'ArgumentException'{'ARGUMENT'}
  'FormatException'{'FORMAT'}
  'InvalidOperationException'{'INVALID_OPERATION'}
  'IOException'{'IO'}
  default{'OTHER'}
 }
 [Console]::Error.WriteLine('JOB_SOURCE_BASE_CLASS|'+$category)
 throw
}""".replace("ORIGINAL_SOURCE_BASE",sourceBase)
    modified_fixture = unique(modified_fixture,sourceBase,sourceProbe)
    modified_fixture = unique(modified_fixture,sourceProbe,
        "Emit-PublicNestedStage 'BEFORE_BASE';"+sourceProbe+";Emit-PublicNestedStage 'AFTER_BASE'")
    modified_fixture = unique(modified_fixture,
        "[Console]::Error.WriteLine('JOB_SOURCE_BASE_CLASS|'+$category)\n throw",
        "[Console]::Error.WriteLine('JOB_SOURCE_BASE_CLASS|'+$category)\n Emit-PublicNestedStage 'BASE_FAIL';throw")
    # The child stops between SOURCE_BASE_BEGIN and SOURCE_BASE_DONE. Check
    # its original Console.ReadLine/ConvertFrom-Json before source initialization.
    inputOriginal="$publicInput=if($OwnedJobWindows -and $TransportGroup -in @(1,2)){$line=[Console]::In.ReadLine();$null=$line|Microsoft.PowerShell.Utility\ConvertFrom-Json;$line}else{[Console]::In.ReadToEnd()}"
    inputVariant="""$publicInput=if($OwnedJobWindows -and $TransportGroup -in @(1,2)){
 $line=$null
 try{
  Emit-PublicNestedStage 'INPUT_READ_BEGIN'
  $line=[Console]::In.ReadLine()
  Emit-PublicNestedStage $(if($null -eq $line){'INPUT_NULL'}else{'INPUT_LINE'})
  Emit-PublicNestedStage $(if($null -ne $line -and $line.StartsWith([string][char]0xFEFF)){'INPUT_BOM'}else{'INPUT_NO_BOM'})
  Emit-PublicNestedStage $(if($null -ne $line -and $line.StartsWith('{')){'INPUT_OBJECT'}else{'INPUT_NONOBJECT'})
  Emit-PublicNestedStage 'INPUT_JSON_BEGIN'
  $null=$line|Microsoft.PowerShell.Utility\ConvertFrom-Json
  Emit-PublicNestedStage 'INPUT_JSON_OK'
  $line
 }catch{
  $category='OTHER'
  if($null -eq $line){$category='NO_LINE'}
  elseif([string]::IsNullOrWhiteSpace($line)){$category='EMPTY'}
  elseif([string]$_.Exception.GetBaseException().Message -match '(?i)json|convertfrom'){$category='PARSE'}
  Emit-PublicNestedStage ('INPUT_FAIL_'+$category)
  [Console]::Error.WriteLine('JOB_DRIVER_INPUT_FAILURE|'+$category)
  throw
 }
}else{[Console]::In.ReadToEnd()}"""
    if bom_trim:
        # This is an explicitly non-acceptance comparison; it may only remove
        # a leading U+FEFF marker from a public fixture input. All original
        # JSON schema/owner/source guards remain.
        inputVariant=unique(inputVariant,
          "  $line=[Console]::In.ReadLine()",
          "  $line=[Console]::In.ReadLine();if($null -ne $line -and $line.StartsWith([string][char]0xFEFF)){$line=$line.Substring(1)}")
    modified_fixture = unique(modified_fixture,inputOriginal,inputVariant)
    modified_fixture = unique(modified_fixture,inputVariant,
        inputVariant+";Emit-PublicNestedStage 'INPUT_READY'")
    # The nested Windows manager must execute the original public fixture.
    # This test compares paths without logging them, and a separate candidate
    # uses the already-verified Root to launch that exact fixture.
    startDriver=modified_fixture.index("function New-PublicPrivateJobDriver(")
    endDriver=modified_fixture.index("function Stop-PublicPrivateJobAllocatedProcess(",startDriver)
    driver=modified_fixture[startDriver:endDriver]
    originalPath="$info.Arguments='-NoLogo -NoProfile -NonInteractive -File \"'+$PSCommandPath+'\" -Root \"'+$Root+'\" -OwnedJobWindows -TransportGroup '+$Group;"
    if explicit_driver_target:
        targetPrefix="$target=[IO.Path]::GetFullPath((Join-Path $Root 'tests/owner-code-cutover-peer.fixture.ps1'));Require ([IO.File]::Exists($target)) 'JOB_DRIVER_TARGET_MISSING';"
        newPath=targetPrefix+originalPath.replace("$PSCommandPath","$target")
    else:
        targetPrefix="$same=$false;try{if($PSCommandPath){$same=[string]::Equals([IO.Path]::GetFullPath($PSCommandPath),[IO.Path]::GetFullPath((Join-Path $Root 'tests/owner-code-cutover-peer.fixture.ps1')),[StringComparison]::OrdinalIgnoreCase)}}catch{};[Console]::Error.WriteLine('JOB_DRIVER_PATH_MATCH|'+$(if($same){'YES'}else{'NO'}));"
        newPath=targetPrefix+originalPath
    driver=unique(driver,originalPath,newPath)
    modified_fixture=modified_fixture[:startDriver]+driver+modified_fixture[endDriver:]
    begin = "assert.equal(child.error,undefined);"
    stageCode = r"""const stages=(child.stderr||'').split(/\r?\n/).filter(x=>/^(?:JOB_EARLY_DRIVER\|(?:ENTER|BUDGET_BEFORE|BUDGET_DONE|STARTINFO_READY|START_BEFORE|START_DONE|STDERR_TASK_READY|WRITE_BEFORE|WRITE_DONE|READ_BEFORE|READ_DONE|PARSE_BEFORE|PARSE_DONE|RETURNED)|JOB_REAL_(?:STAGE\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100})|READ_CONTEXT\|(?:DRIVER|OUTSIDE|UNKNOWN)|PHASE\|(?:OUTSIDE_HELD|CLOCK_REFUSED|ORIGINAL_CLOSED|EARLY_START|MANAGER_START|MANAGER_RESPONSE|FINAL_CHECKED)|OUTSIDE_(?:READ|JSON|HELPER)\|YES)|JOB_DRIVER_(?:CHILD_EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|STDERR_READ\|(?:EOF|DATA|PENDING|FAULT)|TRAP\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|TRAP_CAPTURE\|(?:UNAVAILABLE|UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|SOURCE_BASE\|(?:UNAVAILABLE|UNKNOWN|(?:CUTOVER_BOOTSTRAP_FIXTURE|CUTOVER|PEER_FIXTURE|ROTATION_CUTOVER|JOB)_[A-Z0-9_]{3,120})|SOURCE_CLASS\|(?:UNAVAILABLE|RUNTIME|METHOD|ARGUMENT|FORMAT|INVALID_OPERATION|IO|OTHER)|INPUT_CODE\|(?:UNAVAILABLE|NO_LINE|EMPTY|PARSE|OTHER)|PATH_MATCH\|(?:YES|NO)|ERRCATEGORY\|(?:PARSE|BIND|FILE|ACCESS|BOOTSTRAP|FIXTURE|ROTATION|STRICT|OTHER_ERROR|OTHER))|JOB_READER_(?:COUNT\|(?:ZERO|SHORT|MEDIUM|LONG)|PREFIX\|(?:EMPTY|OBJECT|BOM|OTHER))|JOB_OUTSIDE_(?:PHASE\|(?:INPUT_BEGIN|JSON_OK|HELPER_BEGIN|HELPER_READY|OUTPUT_BEGIN|OUTPUT_SENT|OUTPUT_FAIL)|EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|ERROR_CLASS\|(?:EMPTY|HELPER_TIMEOUT|HELPER_SHAPE|HELPER_LIMIT|HELPER_IDENTITY|HELPER_REFUSED|JSON_SYNTAX|MODULE_NOT_FOUND|REFERENCE_ERROR|TYPE_ERROR|BROKEN_PIPE|FILE_MISSING|NODE_INVALID|NODE_ERROR|OTHER)))$/.test(x));console.log('JOB_REAL_STAGE_CODES '+JSON.stringify(stages.slice(-15)));"""
    statusCode = r"""console.log('JOB_REAL_CHILD '+JSON.stringify({timeout:child.error?.code==='ETIMEDOUT'?'YES':'NO',exit:child.status===0?'ZERO':child.status===null?'NULL':'NONZERO',stderr:child.stderr?'YES':'NO',stdout:child.stdout?'YES':'NO'}));"""
    chunk = unique(chunk, begin, statusCode + stageCode + begin)
    modified_test = test[:start] + chunk + test[end:]
    cp = run_selected(
        "^Windows private original-State Job contains held Node helper and manager death while outside control survives$",
        modified_fixture, modified_test, native_phase=True,
    )
    stage = re.findall(r"JOB_REAL_STAGE_CODES (\[[^\r\n]{1,1800}\])", cp["stdout"])
    stage_codes = json.loads(stage[-1]) if stage else []
    stage_codes = [x for x in stage_codes
                   if isinstance(x,str) and re.fullmatch(
                     r"(?:JOB_EARLY_DRIVER\|(?:ENTER|BUDGET_BEFORE|BUDGET_DONE|STARTINFO_READY|START_BEFORE|START_DONE|STDERR_TASK_READY|WRITE_BEFORE|WRITE_DONE|READ_BEFORE|READ_DONE|PARSE_BEFORE|PARSE_DONE|RETURNED)|JOB_REAL_(?:STAGE\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100})|READ_CONTEXT\|(?:DRIVER|OUTSIDE|UNKNOWN)|PHASE\|(?:OUTSIDE_HELD|CLOCK_REFUSED|ORIGINAL_CLOSED|EARLY_START|MANAGER_START|MANAGER_RESPONSE|FINAL_CHECKED)|OUTSIDE_(?:READ|JSON|HELPER)\|YES)|JOB_DRIVER_(?:CHILD_EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|STDERR_READ\|(?:EOF|DATA|PENDING|FAULT)|TRAP\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|TRAP_CAPTURE\|(?:UNAVAILABLE|UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|SOURCE_BASE\|(?:UNAVAILABLE|UNKNOWN|(?:CUTOVER_BOOTSTRAP_FIXTURE|CUTOVER|PEER_FIXTURE|ROTATION_CUTOVER|JOB)_[A-Z0-9_]{3,120})|SOURCE_CLASS\|(?:UNAVAILABLE|RUNTIME|METHOD|ARGUMENT|FORMAT|INVALID_OPERATION|IO|OTHER)|INPUT_CODE\|(?:UNAVAILABLE|NO_LINE|EMPTY|PARSE|OTHER)|PATH_MATCH\|(?:YES|NO)|ERRCATEGORY\|(?:PARSE|BIND|FILE|ACCESS|BOOTSTRAP|FIXTURE|ROTATION|STRICT|OTHER_ERROR|OTHER))|JOB_READER_(?:COUNT\|(?:ZERO|SHORT|MEDIUM|LONG)|PREFIX\|(?:EMPTY|OBJECT|BOM|OTHER))|JOB_OUTSIDE_(?:PHASE\|(?:INPUT_BEGIN|JSON_OK|HELPER_BEGIN|HELPER_READY|OUTPUT_BEGIN|OUTPUT_SENT|OUTPUT_FAIL)|EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|ERROR_CLASS\|(?:EMPTY|HELPER_TIMEOUT|HELPER_SHAPE|HELPER_LIMIT|HELPER_IDENTITY|HELPER_REFUSED|JSON_SYNTAX|MODULE_NOT_FOUND|REFERENCE_ERROR|TYPE_ERROR|BROKEN_PIPE|FILE_MISSING|NODE_INVALID|NODE_ERROR|OTHER)))",x)]
    native_status=re.findall(r"JOB_REAL_CHILD (\{[^\r\n]{1,250}\})",cp["stdout"])
    native_child=json.loads(native_status[-1]) if native_status else {}
    found = re.findall(r"JOB_REAL_FLAGS (\{[^\r\n]{1,1800}\})", cp["stdout"])
    flags = json.loads(found[-1]) if found else {}
    filtered = {k:flags[k] for k in FLAGS
                if flags.get(k) in ("YES", "NO", "UNKNOWN")}
    return {"run_status":cp["status"], "original_assertions_exit":cp["exit"],
            "flags":filtered, "capture_complete":len(filtered)==len(FLAGS),
            "stage_codes":stage_codes[-15:], "child":native_child,
            "nested_phases":cp.get("nested_phases",{}),
            "acceptance":"NOT_ASSESSED"}

def driver_raw_utf8_candidate(fixture,test):
    """Disposable original Windows test, unchanged assertions, BOM-free raw pipe."""
    original_encoding="$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false);Require ($info.StandardInputEncoding.GetPreamble().Length -eq 0) 'JOB_DRIVER_BOM_FREE_UTF8_REQUIRED'"
    compatible_encoding="$driverUtf8=[Text.UTF8Encoding]::new($false,$true);Require ($driverUtf8.GetPreamble().Length -eq 0) 'JOB_DRIVER_BOM_FREE_UTF8_REQUIRED'"
    original_write="$p.StandardInput.WriteLine($InputJson);$p.StandardInput.Flush();"
    compatible_write=(
        "$wire=[byte[]]$driverUtf8.GetBytes($InputJson+[char]10);"
        "Require ($wire.Length -ge 3 -and $wire.Length -le 32769 -and $wire[$wire.Length-1] -eq [byte]10) 'JOB_DRIVER_UTF8_WIRE_REQUIRED';"
        "$writer=$p.StandardInput.BaseStream;"
        "$writer.Write($wire,0,$wire.Length);$writer.Flush();"
    )
    modified=unique(fixture,original_encoding,compatible_encoding)
    modified=unique(modified,original_write,compatible_write)
    cp=run_selected(
        "^Windows private original-State Job contains held Node helper and manager death while outside control survives$",
        modified,test)
    return {"original_assertions_exit":cp["exit"],"status":cp["status"],
            "raw_utf8_no_bom":True,"original_tests_unchanged":True,
            "production_accepted":False}


def main():
    if sys.argv[1:] != ["--run"] or os.name != "nt" or \
       os.environ.get("GITHUB_REPOSITORY") != REPO or \
       os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise ValueError("HOSTED_WINDOWS_ONLY")
    head = subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()
    if not SHA_RE.fullmatch(head) or head != os.environ.get("GITHUB_SHA"):
        raise ValueError("EXACT_GITHUB_SHA_REQUIRED")
    original_fixture = FIXTURE.read_bytes()
    original_test = TEST.read_bytes()
    report = {"schema":"PR1905_SPLIT_JOB_EVIDENCE_V1",
              "sha":head, "acceptance":"NOT_ASSESSED",
              "production_accepted":False,
              "native_source_modified":False}
    dest = Path(os.environ["RUNNER_TEMP"])/"pr1905-job-split"
    dest.mkdir(exist_ok=False)
    try:
        report["group2"] = group2_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"))
        # Compare the diagnostic against the unchanged original test, not
        # against a test whose stderr was modified for observation.
        original = run_selected(
            "^private original-State owned Job finite policy and cleanup group2 is DATA only$",
            original_fixture.decode("utf-8"), original_test.decode("utf-8"))
        report["group2_original"] = {"run_status":original["status"],
             "exit":original["exit"],"powershell_timeout":
             "YES" if "ETIMEDOUT" in original["stdout"] else "NO",
             "acceptance":"NOT_ASSESSED"}
        report["group2_single_case_diagnostics"] = group2_single_case_diagnostics(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"))
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job"] = real_windows_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"))
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job_exact_target"] = real_windows_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"), True)
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job_bom_candidate"] = real_windows_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"), False, True)
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job_outside_utf8"] = real_windows_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"),
            False, False, True)
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job_async_stdout"] = real_windows_diagnostic(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"),
            False, False, False, True)
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job_raw_utf8_candidate"] = driver_raw_utf8_candidate(
            original_fixture.decode("utf-8"), original_test.decode("utf-8"))
    finally:
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        dest.joinpath("report.json").write_text(
            json.dumps(report, ensure_ascii=True, indent=2)+"\n",
            encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, separators=(",",":")))
    return 0

if __name__ == "__main__":
    sys.exit(main())
