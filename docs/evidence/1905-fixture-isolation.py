"""PR1905 source-bound fixture experiments. No network, credentials or production calls.
Edits are restricted to an ephemeral checkout and emitted as an unapplied patch.
"""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unittest
import zipfile

BASE = 'cfe69a91da20058511083fdd66070ac0bc23bab4'
FIXTURE = 'tests/owner-code-cutover-peer.fixture.ps1'
TEST = 'scripts/owner-code-cutover-peer.test.mjs'
BLOBS = {FIXTURE: 'ce0bf8392b34cc931df3b584143a7217da1139fb', TEST: 'af332cb501682da7ffede47eb560dec4ce9b41a4'}
PATTERN = ('^(real descriptor EOF on either owned channel|actual readonly peer diagnostic returns|'
           'public Windows EOF actor compiles|clock R2 refusal cleans|'
           'private original-State owned Job finite policy and cleanup group2|'
           'Windows private original-State Job contains|private owned Job thrown close)')


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('SOURCE_ANCHOR_NOT_UNIQUE')
    return text.replace(old, new, 1)


def sharing_candidate(text):
    old = '$entryScopeStream.Write($entryScopeBytes,0,$entryScopeBytes.Length);$entryScopeStream.Flush()'
    new = old + '''
 # TEST fixture only: finish the writer before executing a separately opened script.
 $entryScopeStream.Dispose();$entryScopeStream=$null
 $entryScopeFile=[IO.FileInfo]::new($entryScopePath);$entryScopeFile.Refresh()
 Require ($entryScopeFile.Exists -and -not ($entryScopeFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $entryScopeFile.Length -eq $entryScopeBytes.Length) 'ENTRY_CF_SEALED_FILE_REQUIRED'
 $entryScopeBirthFile=$entryScopeFile.CreationTimeUtc.Ticks
 $entryScopeStream=[IO.FileStream]::new($entryScopePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 $entryScopeRead=[byte[]]::new($entryScopeBytes.Length);$entryScopeOffset=0
 while($entryScopeOffset -lt $entryScopeRead.Length){$n=$entryScopeStream.Read($entryScopeRead,$entryScopeOffset,$entryScopeRead.Length-$entryScopeOffset);Require ($n -gt 0) 'ENTRY_CF_SEALED_READ_REQUIRED';$entryScopeOffset+=$n}
 $entryScopeFile.Refresh()
 Require ($entryScopeStream.ReadByte() -eq -1 -and $entryScopeFile.CreationTimeUtc.Ticks -eq $entryScopeBirthFile -and -not ($entryScopeFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -and [Convert]::ToBase64String($entryScopeRead) -ceq [Convert]::ToBase64String($entryScopeBytes)) 'ENTRY_CF_SEALED_BYTES_REQUIRED'
 $entryScopeStream.Position=0'''
    return replace_once(text, old, new)


def diagnostic_candidate(fixture, test):
    old = "Require ($held.Item1.Handle -eq $held.Item2 -and $held.Item1.StartTime.ToUniversalTime().Ticks -eq $held.Item3 -and $held.Item1.HasExited -and @($script:jobDataAssignFailurePipes|Where-Object {-not $_.IsClosed}).Count -eq 0 -and $script:ownedPeerJobPipeState -ceq 'CLOSED') 'JOB_UNASSIGNED_CLOSE_STILL_CERTIFIES_ORIGINAL_NODE_FALLBACK_AND_PIPES'"
    new = ";".join([
        "Require ($held.Item1.Handle -eq $held.Item2) 'JOB_ASSIGN_FAIL_ORIGINAL_HANDLE'",
        "Require ($held.Item1.StartTime.ToUniversalTime().Ticks -eq $held.Item3) 'JOB_ASSIGN_FAIL_ORIGINAL_BIRTH'",
        "Require ($held.Item1.HasExited) 'JOB_ASSIGN_FAIL_NODE_EXIT'",
        "Require (@($script:jobDataAssignFailurePipes|Where-Object {-not $_.IsClosed}).Count -eq 0) 'JOB_ASSIGN_FAIL_PIPE_HANDLES'",
        "Require ($script:ownedPeerJobPipeState -ceq 'CLOSED') 'JOB_ASSIGN_FAIL_PIPE_STATE'",
    ])
    fixture = replace_once(fixture, old, new)
    old_clock = "Require ($script:ownedPeerLifetime.observerContainment -ceq 'CLOSED' -and $script:r2HeldProof.HasExited -and -not $script:ownedPeerCleanupCertificate.Item4.Item1.IsRunning) 'R2_EARLY_ORIGINAL_ACTOR_CLOSED'"
    new_clock = ";".join([
        "Require ($script:ownedPeerLifetime.observerContainment -ceq 'CLOSED') 'R2_EARLY_CONTAINMENT'",
        "Require ($script:r2HeldProof.HasExited) 'R2_EARLY_NODE_EXIT'",
        "Require (-not $script:ownedPeerCleanupCertificate.Item4.Item1.IsRunning) 'R2_EARLY_WATCH_STOP'",
    ])
    fixture = replace_once(fixture, old_clock, new_clock)
    test = replace_once(test, "assert.equal(child.status,0,'PUBLIC_CLOCK_DATA_CASE_FAILED');",
        "assert.equal(child.status,0,(child.stderr.match(/(?:CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE)_[A-Z0-9_]{1,150}/)||['PUBLIC_CLOCK_DATA_CASE_FAILED'])[0]);")
    old_line = next(line for line in test.splitlines() if "'-OwnedJobWindows'" in line and 'assert.equal(r.pass,true)' in line)
    new_line = re.sub(r"assert.equal\(r\.([A-Za-z]+),true\)", lambda m: "assert.equal(r."+m[1]+",true,'JOB_WINDOWS_"+m[1].upper()+"')", old_line)
    test = replace_once(test, old_line, new_line)
    return fixture, test


def run_tests(label, pattern, timeout=180):
    started = time.monotonic()
    proc = subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    output = proc.stdout + '\n' + proc.stderr
    codes = sorted(set(re.findall(r'\b(?:CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|PUBLIC_EOF|PUBLIC_CLOCK|JOB_WINDOWS)_[A-Z0-9_]{1,150}\b',output)))
    totals = {}
    for name in ('tests','pass','fail','cancelled','skipped'):
        found = re.findall(r'(?:ℹ|#) '+name+r' (\d+)',output)
        totals[name] = int(found[-1]) if found else None
    return {'label':label,'exit':proc.returncode,'seconds':round(time.monotonic()-started,3),'totals':totals,'failure_codes':codes}


def decoder_probe(fixture, directory):
    match = re.search(r"\$snapshotContract=\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)",fixture)
    if not match:
        raise ValueError('DECODER_SOURCE_REQUIRED')
    body = base64.b64decode(match[1],validate=True).decode('utf-8')
    old = '$bytes=New-Bytes $width ([ulong[]]@(4,8,12));$result=$type::Decode($bytes,$bytes.Length,$width,0,[ulong]4);'
    new = '''$bytes=New-Bytes $width ([ulong[]]@(4,8,12));[Console]::Out.WriteLine('DECODER_VECTOR|'+$width+'|'+$bytes.Length+'|'+$bytes.GetType().FullName);$result=$type::Decode($bytes,$bytes.Length,$width,0,[ulong]4);[Console]::Out.WriteLine('DECODER_RETURN|'+$width+'|'+$result.Count);'''
    body = replace_once(body,old,new)
    encoded = base64.b64encode(body.encode()).decode()
    ps = r'''param([string]$Fixture)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
try {
 $t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Fixture,[ref]$t,[ref]$e)
 if($e.Count){throw 'SOURCE_PARSE'}
 $f=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-PublicWindowsEofActorSource'},$true))
 if($f.Count -ne 1){throw 'SOURCE_AMBIGUOUS'}
 .([scriptblock]::Create($f[0].Extent.Text));$source=Get-PublicWindowsEofActorSource
 if($PSVersionTable.PSVersion.Major -eq 5){$r=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory();Add-Type -TypeDefinition $source -ReferencedAssemblies @((Join-Path $r 'System.Runtime.Serialization.dll'),(Join-Path $r 'System.Xml.dll')) -ErrorAction Stop}else{Add-Type -TypeDefinition $source -ErrorAction Stop}
 $header='PublicEofOwnSnapshotHeader' -as [type];$entry='PublicEofOwnSnapshotEntry' -as [type]
 [Console]::Out.WriteLine('DECODER_LAYOUT|'+[IntPtr]::Size+'|'+[Runtime.InteropServices.Marshal]::SizeOf($header)+'|'+[Runtime.InteropServices.Marshal]::SizeOf($entry))
 $b=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__BODY__'))
 $value=&([scriptblock]::Create($b)) -Fixture $Fixture
 [Console]::Out.WriteLine('DECODER_COMPLETE')
} catch {
 $known=@('RuntimeException','MethodException','MethodInvocationException','PSInvalidCastException','ArgumentException','InvalidOperationException','TypeLoadException','MissingMethodException','OverflowException','InvalidCastException','TargetInvocationException')
 $name=$_.Exception.GetBaseException().GetType().Name;if($known -cnotcontains $name){$name='OTHER'}
 [Console]::Out.WriteLine('DECODER_FAILURE|'+$name+'|'+[int]$_.Exception.GetBaseException().HResult)
 exit 1
}
'''.replace('__BODY__',encoded)
    target=directory/'decoder-probe.ps1';target.write_text(ps,encoding='utf-8')
    shell = os.path.join(os.environ.get('SystemRoot','C:\\Windows'),'System32','WindowsPowerShell','v1.0','powershell.exe') if os.name=='nt' else 'pwsh'
    proc=subprocess.run([shell,'-NoLogo','-NoProfile','-NonInteractive','-File',str(target),'-Fixture',str(Path(FIXTURE).resolve())],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
    rows=[line for line in proc.stdout.splitlines() if re.fullmatch(r'DECODER_[A-Z_]+(?:\|[A-Za-z0-9_.\[\]-]{1,80})*',line)]
    return {'label':'decoder-source-bound-pure-control','exit':proc.returncode,'observations':rows[:12],'native_calls':False}


class HarnessTests(unittest.TestCase):
    def test_unique_anchor_required(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_ANCHOR_NOT_UNIQUE'):
            replace_once('aa','a','b')
    def test_missing_anchor_required(self):
        with self.assertRaises(ValueError): replace_once('','a','b')
    def test_writer_closed_then_readonly(self):
        source='$entryScopeStream.Write($entryScopeBytes,0,$entryScopeBytes.Length);$entryScopeStream.Flush()'
        result=sharing_candidate(source)
        self.assertLess(result.index('.Dispose()'),result.index('[IO.FileMode]::Open'))
        self.assertIn('[IO.FileAccess]::Read,[IO.FileShare]::Read)',result)
        self.assertNotIn('[IO.FileShare]::ReadWrite',result)
        self.assertIn('ENTRY_CF_SEALED_BYTES_REQUIRED',result)


def main():
    if sys.argv[1:]==['--self-test']:
        unittest.main(argv=[sys.argv[0]],verbosity=2);return
    if sys.argv[1:] != ['--run'] or os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!='haji84/AI-' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
        raise ValueError('HOSTED_EXPLICIT_CONTEXT_REQUIRED')
    for path,expected in BLOBS.items():
        actual=subprocess.check_output(['git','hash-object',path],text=True).strip()
        if actual!=expected: raise ValueError('SOURCE_DRIFT_'+Path(path).suffix)
    output=Path(os.environ['RUNNER_TEMP'])/'pr1905-fixture-isolation';output.mkdir(exist_ok=False)
    originals={p:Path(p).read_bytes() for p in BLOBS}
    report={'schema':'PR1905_FIXTURE_ISOLATION_V1','source_base':BASE,'tested_head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'platform':sys.platform,'production_accepted':False,'source_fix_integrated':False,'runs':[]}
    try:
        with zipfile.ZipFile(output/'public-source.zip','w',zipfile.ZIP_DEFLATED) as z:
            for p,data in originals.items(): z.writestr(p,data)
            for p in ['scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-rotation-native-1218.mjs','tests/owner-code-cutover-private-bootstrap.fixture.ps1','scripts/owner-code-cutover-private-bootstrap.test.mjs']:
                z.writestr(p,subprocess.check_output(['git','show',BASE+':'+p]))
        report['runs'].append(run_tests('original-selected-failures',PATTERN))
        fixture=originals[FIXTURE].decode('utf-8');test=originals[TEST].decode('utf-8')
        report['runs'].append(decoder_probe(fixture,output))
        fixture=sharing_candidate(fixture)
        Path(FIXTURE).write_bytes(fixture.encode('utf-8'))
        report['runs'].append(run_tests('readonly-sealed-script-candidate','^actual readonly peer diagnostic returns',40))
        fixture,test=diagnostic_candidate(fixture,test)
        Path(FIXTURE).write_bytes(fixture.encode('utf-8'));Path(TEST).write_bytes(test.encode('utf-8'))
        report['runs'].append(run_tests('separated-job-clock-contracts',PATTERN))
        patch=subprocess.check_output(['git','diff','--no-ext-diff','--',FIXTURE,TEST])
        (output/'candidate.patch').write_bytes(patch)
        report['patch_sha256']=hashlib.sha256(patch).hexdigest()
    finally:
        for p,data in originals.items(): Path(p).write_bytes(data)
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2))
    if report['runs'][-1].get('exit')!=0:
        sys.exit(1)

if __name__=='__main__': main()
