#!/usr/bin/env python3
"""PR1905 disposable Windows Job differential evidence, never production acceptance."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

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

def run_selected(pattern, fixture_text, test_text, progress=False):
    FIXTURE.write_text(fixture_text, encoding="utf-8")
    TEST.write_text(test_text, encoding="utf-8")
    progress_root = None
    run_env = None
    if progress:
        progress_root = Path(os.environ["RUNNER_TEMP"])/"pr1905-job2-progress"
        progress_root.mkdir(exist_ok=False)
        run_env = os.environ.copy()
        run_env["GORIQ_PUBLIC_PEER_PROGRESS_DIRECTORY"] = str(progress_root)
    def progress_file_names():
        if progress_root is None: return []
        return sorted(f.name for f in progress_root.iterdir()
                      if re.fullmatch(r"(?:OWNED|CLOSED|PLATFORM)_[012]\.txt",f.name))
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
                "stdout": cp.stdout, "stderr": cp.stderr, "progress": phases(), "progress_files":progress_file_names()}
    except subprocess.TimeoutExpired:
        return {"status": "DIAGNOSTIC_TIMEOUT", "exit": None,
                "stdout": "", "stderr": "", "progress": phases(), "progress_files":progress_file_names()}

def group2_diagnostic(fixture, test):
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

def real_windows_diagnostic(fixture, test):
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
 if($value -cmatch '\\A(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100}\\z'){$reason=$value}
 [Console]::Error.WriteLine('JOB_REAL_STAGE|'+$reason)
 $script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}
}"""
    modified_fixture = unique(fixture, fixtureCatch, fixtureProbe)
    # Two distinct read sites. The label is diagnostic state only, not proof
    # that the worker was assigned or that any native Job is valid.
    modified_fixture = unique(
        modified_fixture,
        "$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;",
        "$script:publicJobReadStage='DRIVER';$line=Read-PublicPrivateJobLine $p.StandardOutput 4096;")
    modified_fixture = unique(
        modified_fixture,
        "$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;",
        "$script:publicJobReadStage='OUTSIDE';$outsideWire=Read-PublicPrivateJobLine $outside.StandardOutput 32768;")
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
 break
}
# BEGIN_COMPOSED_PRIVATE_TEST_MODE"""
    modified_fixture = unique(modified_fixture,trapAnchor,trapCode)
    begin = "assert.equal(child.error,undefined);"
    stageCode = r"""const stages=(child.stderr||'').split(/\r?\n/).filter(x=>/^(?:JOB_REAL_(?:STAGE\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100})|READ_CONTEXT\|(?:DRIVER|OUTSIDE|UNKNOWN))|JOB_DRIVER_(?:CHILD_EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|STDERR_READ\|(?:EOF|DATA|PENDING|FAULT)|TRAP\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|TRAP_CAPTURE\|(?:UNAVAILABLE|UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})))$/.test(x));console.log('JOB_REAL_STAGE_CODES '+JSON.stringify(stages.slice(-5)));"""
    statusCode = r"""console.log('JOB_REAL_CHILD '+JSON.stringify({timeout:child.error?.code==='ETIMEDOUT'?'YES':'NO',exit:child.status===0?'ZERO':child.status===null?'NULL':'NONZERO',stderr:child.stderr?'YES':'NO',stdout:child.stdout?'YES':'NO'}));"""
    chunk = unique(chunk, begin, statusCode + stageCode + begin)
    modified_test = test[:start] + chunk + test[end:]
    cp = run_selected(
        "^Windows private original-State Job contains held Node helper and manager death while outside control survives$",
        modified_fixture, modified_test,
    )
    stage = re.findall(r"JOB_REAL_STAGE_CODES (\[[^\r\n]{1,1000}\])", cp["stdout"])
    stage_codes = json.loads(stage[-1]) if stage else []
    stage_codes = [x for x in stage_codes
                   if isinstance(x,str) and re.fullmatch(
                     r"(?:JOB_REAL_(?:STAGE\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{2,100})|READ_CONTEXT\|(?:DRIVER|OUTSIDE|UNKNOWN))|JOB_DRIVER_(?:CHILD_EXITED\|(?:YES|NO)|EXIT_CODE\|(?:ZERO|NONZERO|UNKNOWN)|STDERR_READ\|(?:EOF|DATA|PENDING|FAULT)|TRAP\|(?:UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})|TRAP_CAPTURE\|(?:UNAVAILABLE|UNKNOWN|(?:JOB|PUBLIC_JOB|CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|ROTATION_CUTOVER)_[A-Z0-9_]{2,100})))",x)]
    native_status=re.findall(r"JOB_REAL_CHILD (\{[^\r\n]{1,250}\})",cp["stdout"])
    native_child=json.loads(native_status[-1]) if native_status else {}
    found = re.findall(r"JOB_REAL_FLAGS (\{[^\r\n]{1,1800}\})", cp["stdout"])
    flags = json.loads(found[-1]) if found else {}
    filtered = {k:flags[k] for k in FLAGS
                if flags.get(k) in ("YES", "NO", "UNKNOWN")}
    return {"run_status":cp["status"], "original_assertions_exit":cp["exit"],
            "flags":filtered, "capture_complete":len(filtered)==len(FLAGS),
            "stage_codes":stage_codes[-5:], "child":native_child,
            "acceptance":"NOT_ASSESSED"}

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
        FIXTURE.write_bytes(original_fixture)
        TEST.write_bytes(original_test)
        report["windows_real_job"] = real_windows_diagnostic(
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
