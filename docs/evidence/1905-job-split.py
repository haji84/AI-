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

def run_selected(pattern, fixture_text, test_text):
    FIXTURE.write_text(fixture_text, encoding="utf-8")
    TEST.write_text(test_text, encoding="utf-8")
    try:
        cp = subprocess.run(
            ["node", "--test", "--test-concurrency=1",
             "--test-name-pattern=" + pattern, str(TEST)],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=48, check=False,
        )
        return {"status": "RETURNED", "exit": cp.returncode,
                "stdout": cp.stdout, "stderr": cp.stderr}
    except subprocess.TimeoutExpired:
        return {"status": "DIAGNOSTIC_TIMEOUT", "exit": None,
                "stdout": "", "stderr": ""}

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
        modified_fixture, modified_test,
    )
    found = re.findall(r"JOB_GROUP2_FLAGS (\[[^\r\n]{1,800}\])", cp["stdout"])
    vals = json.loads(found[-1]) if found else []
    timeout = re.findall(r"JOB_GROUP2_TIMEOUT (YES|NO)", cp["stdout"])
    phases = []
    for item in vals:
        if isinstance(item, str) and re.fullmatch(
            r"JOB_GROUP2_(?:STATE|PIPES|FAKE|OWNER|CANONICAL|ATTEMPTS)\|(?:YES|NO)", item
        ):
            phases.append(item)
    return {"run_status": cp["status"], "original_assertions_exit": cp["exit"],
            "powershell_timeout": timeout[-1] if timeout else "UNKNOWN",
            "predicate_rows": phases, "acceptance": "NOT_ASSESSED"}

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
    modified_test = test[:start] + chunk + test[end:]
    cp = run_selected(
        "^Windows private original-State Job contains held Node helper and manager death while outside control survives$",
        fixture, modified_test,
    )
    found = re.findall(r"JOB_REAL_FLAGS (\{[^\r\n]{1,1800}\})", cp["stdout"])
    flags = json.loads(found[-1]) if found else {}
    filtered = {k:flags[k] for k in FLAGS
                if flags.get(k) in ("YES", "NO", "UNKNOWN")}
    return {"run_status":cp["status"], "original_assertions_exit":cp["exit"],
            "flags":filtered, "capture_complete":len(filtered)==len(FLAGS),
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
