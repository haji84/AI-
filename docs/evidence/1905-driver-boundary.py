#!/usr/bin/env python3
"""Existing PR1905 hosted fixture diagnosis. No production/native authority."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

FIXTURE = 'tests/owner-code-cutover-peer.fixture.ps1'
TEST = 'scripts/owner-code-cutover-peer.test.mjs'
PINS = {FIXTURE: 'f52fc6762f09d0dcc14258f15b16f0454e5fed14',
        TEST: '2ee4f80155f78d1062f461b26d9a6a829a3037a6'}
PUBLIC_SOURCES = (FIXTURE, TEST,
    'tests/owner-code-cutover-private-bootstrap.fixture.ps1',
    'tests/verifier-container.test.mjs', '.github/workflows/ci.yml',
    'docs/evidence/1905-fixture-stage2.py')
NAME = '^Windows private original-State Job contains held Node helper and manager death while outside control survives$'
STAGES = frozenset(('BEGIN EARLY_REFUSAL OWNED_START OWNED_HELPER OUTSIDE_START '
    'OUTSIDE_WIRE OUTSIDE_HELPER CLOCK_EXPIRE OWNED_CLOSE EARLY_DRIVER '
    'EARLY_CHILD_STARTED EARLY_CHILD_SENT EARLY_CHILD_LINE EARLY_CHILD_PARSED '
    'EARLY_CHILD_RETURNED EARLY_CHILD_PROOF EARLY_CHILD_STDERR MANAGER_DRIVER '
    'MANAGER_STOP COMPLETE').split())
PROBES = frozenset(('READ_BEGIN INPUT_LINE_RETURN INPUT_EMPTY INPUT_NULL INPUT_OBJECT '
    'INPUT_OTHER PARSE_BEGIN PARSE_DONE BASE_BEGIN BASE_DONE SCRIPT_THROW '
    'FAIL_LINE_TIMEOUT FAIL_LINE_PARTIAL FAIL_EARLY_PROOF FAIL_OTHER INPUT_BOM INPUT_BOM_PREFIX WRITER_BOM WRITER_NO_BOM').split())


def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('EXACT_SOURCE_ANCHOR_REQUIRED')
    return source.replace(old, new, 1)


def summarize(output, code, seconds):
    values = re.findall(r'PUBLIC_WINDOWS_JOB_LAST_STAGE=([A-Z_]+)', output)
    stage = values[-1] if values and values[-1] in STAGES else 'UNKNOWN'
    return {'exit': code, 'elapsed_seconds': round(seconds, 3), 'last_stage': stage,
            'child_timeout_observed': 'ETIMEDOUT' in output,
            'acceptance': 'NOT_ASSESSED', 'production_accepted': False}


def candidate(source, mode):
    if mode == 'baseline':
        return source
    if mode == 'early-eof':
        return once(source, '$writer.Flush();if($Group -eq 2)',
                    '$writer.Flush();if($Group -eq 2){$writer.Close()};if($Group -eq 2)')
    if mode == 'explicit-utf8-reader':
        return once(source, '$line=[Console]::In.ReadLine();',
            '$driverInputReader=[IO.StreamReader]::new([Console]::OpenStandardInput(),'
            '[Text.UTF8Encoding]::new($false,$true),$false,1024,$true);'
            '$line=$driverInputReader.ReadLine();')
    if mode == 'bomfree-start':
        return once(source, "try{Require ($p.Start()) 'JOB_FIXED_MANAGER_START';",
            "try{$priorDriverInputEncoding=[Console]::InputEncoding;"
            "try{[Console]::InputEncoding=$driverUtf8;"
            "Require ($p.Start()) 'JOB_FIXED_MANAGER_START'}"
            "finally{[Console]::InputEncoding=$priorDriverInputEncoding};"
            "Require ($p.StandardInput.Encoding.GetPreamble().Length -eq 0) 'JOB_ACTUAL_DRIVER_WRITER_BOM_FREE_REQUIRED';")
    raise ValueError('UNKNOWN_CANDIDATE')


def instrument(source):
    """Only closed file diagnostics; never change an original predicate/budget."""
    helper = r'''
function Write-PublicDriverBoundary([string]$Code){
 try{
  if($Code -cnotin @('READ_BEGIN','INPUT_LINE_RETURN','INPUT_EMPTY','INPUT_NULL','INPUT_OBJECT','INPUT_OTHER','PARSE_BEGIN','PARSE_DONE','BASE_BEGIN','BASE_DONE','SCRIPT_THROW','FAIL_LINE_TIMEOUT','FAIL_LINE_PARTIAL','FAIL_EARLY_PROOF','FAIL_OTHER','INPUT_BOM','INPUT_BOM_PREFIX','WRITER_BOM','WRITER_NO_BOM')){return}
  if(-not $env:GORIQ_PR1905_DRIVER_BOUNDARY){return}
  $root=[IO.Path]::GetFullPath($env:GORIQ_PR1905_DRIVER_BOUNDARY)
  $temp=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))+[IO.Path]::DirectorySeparatorChar
  if(-not $root.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($root) -cnotmatch '^pr1905-driver-[A-Za-z0-9_]+$' -or -not [IO.Directory]::Exists($root)){return}
  $path=Join-Path $root ('GROUP_'+[int]$TransportGroup+'.txt')
  if([IO.File]::Exists($path) -and ([IO.FileInfo]::new($path)).Length -gt 2048){return}
  [IO.File]::AppendAllText($path,$Code+[char]10,[Text.Encoding]::ASCII)
 }catch{}
}
trap {Write-PublicDriverBoundary 'SCRIPT_THROW';throw}
'''
    anchor = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';Set-StrictMode -Version Latest"
    source = once(source, anchor, anchor + helper)
    source = once(source,
        "Write-PublicPeerProgress 'GROUP_BEGIN';Write-PublicPeerProgress 'SOURCE_BASE_BEGIN'",
        "Write-PublicPeerProgress 'GROUP_BEGIN';Write-PublicPeerProgress 'SOURCE_BASE_BEGIN';Write-PublicDriverBoundary 'READ_BEGIN'")
    source = once(source,
        "$null=$line|Microsoft.PowerShell.Utility\\ConvertFrom-Json;$line}else{[Console]::In.ReadToEnd()};$null=. (Join-Path $Root 'tests/owner-code-cutover-private-bootstrap.fixture.ps1') -Scenario kernel -FixtureInput $publicInput -UseExistingNative75",
        "Write-PublicDriverBoundary 'INPUT_LINE_RETURN';if($null -eq $line){Write-PublicDriverBoundary 'INPUT_NULL'}elseif($line.Length -eq 0){Write-PublicDriverBoundary 'INPUT_EMPTY'}elseif($line[0] -eq '{'){Write-PublicDriverBoundary 'INPUT_OBJECT'}elseif($line[0] -eq [char]0xFEFF){Write-PublicDriverBoundary 'INPUT_BOM'}elseif($line.Length -ge 3 -and [int]$line[0] -eq 239 -and [int]$line[1] -eq 187 -and [int]$line[2] -eq 191){Write-PublicDriverBoundary 'INPUT_BOM_PREFIX'}else{Write-PublicDriverBoundary 'INPUT_OTHER'};Write-PublicDriverBoundary 'PARSE_BEGIN';$null=$line|Microsoft.PowerShell.Utility\\ConvertFrom-Json;Write-PublicDriverBoundary 'PARSE_DONE';$line}else{[Console]::In.ReadToEnd()};Write-PublicDriverBoundary 'BASE_BEGIN';$null=. (Join-Path $Root 'tests/owner-code-cutover-private-bootstrap.fixture.ps1') -Scenario kernel -FixtureInput $publicInput -UseExistingNative75;Write-PublicDriverBoundary 'BASE_DONE'")
    source = once(source, "$wire=[byte[]]$driverUtf8.GetBytes($InputJson+[char]10);",
        "if($p.StandardInput.Encoding.GetPreamble().Length -gt 0){Write-PublicDriverBoundary 'WRITER_BOM'}else{Write-PublicDriverBoundary 'WRITER_NO_BOM'};$wire=[byte[]]$driverUtf8.GetBytes($InputJson+[char]10);")
    reason = r"""$probeCode='FAIL_OTHER';$probeMessage=$_.Exception.GetBaseException().Message;foreach($prefix in @('PEER_FIXTURE_','CUTOVER_BOOTSTRAP_FIXTURE_')){if($probeMessage -ceq ($prefix+'JOB_PRIVATE_LINE_TIMEOUT')){$probeCode='FAIL_LINE_TIMEOUT'}elseif($probeMessage -ceq ($prefix+'JOB_PRIVATE_LINE_PARTIAL')){$probeCode='FAIL_LINE_PARTIAL'}elseif($probeMessage -ceq ($prefix+'JOB_FIXED_EARLY_DRIVER')){$probeCode='FAIL_EARLY_PROOF'}};Write-PublicDriverBoundary $probeCode;"""
    return once(source, '}catch{$phase=if($script:jobWindowsPhase',
                '}catch{' + reason + '$phase=if($script:jobWindowsPhase')


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True,
                          timeout=15).stdout


def run_case(source, mode, root, instrumented):
    before = Path(FIXTURE).read_bytes()
    probe_root = Path(tempfile.mkdtemp(prefix='pr1905-driver-', dir=root))
    started = time.monotonic()
    try:
        altered = candidate(source, mode)
        if instrumented:
            altered = instrument(altered)
        Path(FIXTURE).write_bytes(altered.encode('utf-8'))
        env = os.environ.copy()
        env['GORIQ_PR1905_DRIVER_BOUNDARY'] = str(probe_root)
        try:
            result = subprocess.run(['node', '--test', '--test-concurrency=1',
                '--test-name-pattern=' + NAME, TEST], capture_output=True,
                encoding='utf-8', errors='replace', timeout=30, env=env)
            text = result.stdout + '\n' + result.stderr
            if len(text) > 1_000_000:
                raise ValueError('DIAGNOSTIC_OUTPUT_BOUND')
            report = summarize(text, result.returncode, time.monotonic() - started)
        except subprocess.TimeoutExpired:
            report = summarize('', None, time.monotonic() - started)
            report['diagnostic_timeout'] = True
        report['mode'] = mode
        report['instrumented'] = instrumented
        report['candidate_sha256'] = hashlib.sha256(altered.encode()).hexdigest()
        phases = {}
        for group in (0, 1, 2):
            file = probe_root / ('GROUP_' + str(group) + '.txt')
            if file.is_file() and not file.is_symlink() and file.stat().st_size <= 4096:
                rows = file.read_text(encoding='ascii', errors='strict').splitlines()
                if len(rows) <= 64 and all(row in PROBES for row in rows):
                    phases[str(group)] = rows
        report['phases'] = phases
        return report
    finally:
        Path(FIXTURE).write_bytes(before)
        if Path(FIXTURE).read_bytes() != before:
            raise ValueError('SOURCE_RESTORE_FAILED')
        shutil.rmtree(probe_root)


def run():
    if (sys.argv != [sys.argv[0], '--run'] or sys.platform != 'win32'
        or os.environ.get('GITHUB_ACTIONS') != 'true'
        or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
        or os.environ.get('GITHUB_REPOSITORY') != 'haji84/AI-'
        or os.environ.get('GITHUB_REF') != 'refs/heads/fix/1218-production-cutover-40'):
        raise ValueError('DISPOSABLE_HOSTED_CONTEXT_REQUIRED')
    sha = git('rev-parse', 'HEAD').decode().strip()
    if sha != os.environ.get('GITHUB_SHA') or not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('EXACT_HEAD_REQUIRED')
    if git('status', '--porcelain', '-uall').strip():
        raise ValueError('CLEAN_CHECKOUT_REQUIRED')
    version = subprocess.run(['node', '--version'], check=True, capture_output=True,
                             text=True, timeout=5).stdout.strip()
    if version != 'v24.19.0':
        raise ValueError('EXACT_NODE_REQUIRED')
    root = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    out = root / 'pr1905-driver-boundary'
    out.mkdir(exist_ok=False)
    sources = {}
    manifest = {'source_sha': sha, 'classification': 'PUBLIC_TRACKED_SOURCES_ONLY', 'files': {}}
    for path in PUBLIC_SOURCES:
        data = git('show', sha + ':' + path)
        if not 0 < len(data) <= 1_048_576:
            raise ValueError('SOURCE_SIZE_BOUND')
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if path in PINS and blob != PINS[path]:
            raise ValueError('SOURCE_PIN_MISMATCH')
        sources[path] = data
        manifest['files'][path] = {'git_blob': blob, 'sha256': hashlib.sha256(data).hexdigest()}
    with zipfile.ZipFile(out / 'public-sources.zip', 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for path, data in sources.items():
            archive.writestr(path, data)
        archive.writestr('manifest.json', json.dumps(manifest, sort_keys=True, indent=2))
    original = Path(FIXTURE).read_bytes()
    original_test = Path(TEST).read_bytes()
    report = {'schema': 'PR1905_DRIVER_BOUNDARY_V1', 'sha': sha, 'production_accepted': False,
              'native_source_modified': False, 'original_test_sha256': hashlib.sha256(original_test).hexdigest(),
              'per_original_process_timeout_ms': 15000, 'original_line_timeout_ms': 2500,
              'runs': [], 'sources_restored': False}
    try:
        source = sources[FIXTURE].decode('utf-8')
        group_started = time.monotonic()
        try:
            group = subprocess.run(['node', '--test', '--test-concurrency=1',
                '--test-name-pattern=^private original-State owned Job finite policy and cleanup group2 is DATA only$',
                TEST], capture_output=True, encoding='utf-8', errors='replace', timeout=48)
            report['original_group2'] = summarize(group.stdout + '\n' + group.stderr,
                group.returncode, time.monotonic() - group_started)
        except subprocess.TimeoutExpired:
            report['original_group2'] = {'exit': None, 'diagnostic_timeout': True,
                                         'acceptance': 'NOT_ASSESSED'}
        for mode, instrumented in (('baseline', False), ('baseline', True),
                                   ('bomfree-start', True), ('bomfree-start', False)):
            report['runs'].append(run_case(source, mode, root, instrumented))
    finally:
        Path(FIXTURE).write_bytes(original)
        report['sources_restored'] = (Path(FIXTURE).read_bytes() == original
                                     and Path(TEST).read_bytes() == original_test)
        (out / 'report.json').write_text(json.dumps(report, sort_keys=True, indent=2), encoding='utf-8')
    if not report['sources_restored']:
        raise ValueError('SOURCE_RESTORE_FAILED')
    # A diagnostic candidate success is not original-source or physical acceptance.
    return 0 if report['runs'] and report['runs'][0]['exit'] == 0 else 1


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except (ValueError, OSError, subprocess.SubprocessError):
        print('PR1905_DRIVER_DIAGNOSTIC_REFUSED', file=sys.stderr)
        raise SystemExit(1)
