"""Bounded PR1905 stage-two diagnostics; exact public fixtures only."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

NATIVE='scripts/owner-code-rotation-native-1218.ps1'
FIXTURE='tests/owner-code-cutover-peer.fixture.ps1'
TEST='scripts/owner-code-cutover-peer.test.mjs'
EXPECTED={NATIVE:'d2fb7ab5af7f5f18d2463bd21a32a80fcf9f1678',FIXTURE:'3d3e6f210390eb88edbee9fc8c5278e2bd41d92c',TEST:'af332cb501682da7ffede47eb560dec4ce9b41a4'}


def once(s,a,b):
    if s.count(a)!=1: raise ValueError('ANCHOR_REQUIRED')
    return s.replace(a,b,1)


def annotate_native(source):
    begin=source.index('  function Close-OwnerCutoverOwnedPeerPipes {')
    end=source.index('  function Close-OwnerCutoverOwnedPeerObserver {',begin)
    block=source[begin:end]
    counter=[0]
    def guard(_):
        counter[0]+=1
        return "[Console]::Error.WriteLine('PIPE_GUARD_%02d');return"%counter[0]
    block=re.sub(r'\breturn\b',guard,block)
    counter_c=[0]
    def caught(_):
        counter_c[0]+=1
        return "catch{$all=$false;[Console]::Error.WriteLine('PIPE_CATCH_%02d|'+$_.Exception.GetBaseException().GetType().Name+'|'+$_.Exception.GetBaseException().HResult)}"%counter_c[0]
    block=re.sub(re.escape('catch{$all=$false}'),caught,block)
    block=once(block,"   }catch{}\n", "   }catch{[Console]::Error.WriteLine('PIPE_OUTER|'+$_.Exception.GetBaseException().GetType().Name+'|'+$_.Exception.GetBaseException().HResult)}\n")
    return source[:begin]+block+source[end:]


def cleanup_wrapper_candidate(native):
    # The original CWT/job/certificate checks are not removed. Any extra
    # disposal is of the original, already-exited Process's own wrappers only.
    marker="    $all=$true;foreach($pair in $refs){try{if($pair -isnot"
    if native.count(marker)!=1: raise ValueError('PIPE_ORIGINAL_ANCHOR_REQUIRED')
    extra=("    $all=$true;"
           "if($c.Item2 -isnot [Diagnostics.Process] -or -not $c.Item2.HasExited){return};"
           "foreach($wrapper in @($c.Item2.StandardInput,$c.Item2.StandardOutput,$c.Item2.StandardError)){"
           "try{$wrapper.Dispose()}catch{$all=$false}};"
           "foreach($pair in $refs){try{if($pair -isnot")
    return native.replace(marker,extra,1)

def annotate_fixture(source):
    a="}catch{$script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}}"
    b="""}catch{$publicStageReason='UNKNOWN';$publicMessage=$_.Exception.GetBaseException().Message;if($publicMessage -cmatch '\\A(?:PEER_FIXTURE|CUTOVER_BOOTSTRAP_FIXTURE)_[A-Z0-9_]{1,150}\\z'){$publicStageReason=$publicMessage};[Console]::Error.WriteLine('JOB_NATIVE_STAGE|'+$publicStageReason+'|'+$_.Exception.GetBaseException().GetType().Name);$script:jobWindowsResult=@{pass=$false;status='INCONCLUSIVE';code='PUBLIC_PRIVATE_JOB_WINDOWS_PROOF_UNCONFIRMED';nativeAuthority=$false}}"""
    return once(source,a,b)


def decoder(fixture,out,explicit_values=False,renamed=False):
    match=re.search(r"\$snapshotContract=\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)",fixture)
    body=base64.b64decode(match[1],validate=True).decode()
    a='$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));$result=$type::Decode($bytes,$bytes.Length,$width,0,[System.UInt64]4);'
    b="$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));[Console]::Out.WriteLine('DEC_VECTOR|'+$width+'|'+$bytes.Length+'|'+$bytes.GetType().FullName);$result=$type::Decode($bytes,$bytes.Length,$width,0,[System.UInt64]4);[Console]::Out.WriteLine('DEC_RETURN|'+$width+'|'+$result.Count);"
    body=once(body,a,b)
    if explicit_values:
        body=once(body,'$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12))',
            '$publicValues=[System.UInt64[]]@([System.UInt64]4,[System.UInt64]8,[System.UInt64]12);$bytes=New-Bytes -Width $width -Values $publicValues')
        body=once(body,'$b=New-Bytes $width $values',
            '$b=New-Bytes -Width $width -Values $values')
        body=once(body,'$valid=New-Bytes 8 ([System.UInt64[]]@(4))',
            '$valid=New-Bytes -Width 8 -Values ([System.UInt64[]]@([System.UInt64]4))')
    body=once(body,'$t=$null;$e=$null;$ast=',"[Console]::Out.WriteLine('DEC_SCRIPT_ENTER');$t=$null;$e=$null;$ast=")
    body=once(body,'$source=Get-PublicWindowsEofActorSource',"$source=Get-PublicWindowsEofActorSource;[Console]::Out.WriteLine('DEC_SOURCE_OK')")
    body=once(body,"$type='PublicEofOwnHandleSnapshot' -as [type];", "[Console]::Out.WriteLine('DEC_TYPE_BEGIN');$type='PublicEofOwnHandleSnapshot' -as [type];")
    body=once(body,'$rows=@();$bad=@()',"[Console]::Out.WriteLine('DEC_FUNCTIONS_READY');$rows=@();$bad=@()")
    body=once(body,'foreach($width in @(4,8)){',"[Console]::Out.WriteLine('DEC_LOOP_READY');foreach($width in @(4,8)){[Console]::Out.WriteLine('DEC_LOOP_ENTER|'+$width);")

    if not explicit_values and not renamed:
        # Distinguish a parameter conversion problem, missing function,
        # and actual decoder invocation with finite non-secret status.
        body=once(body,'$bytes=New-Bytes $width ([System.UInt64[]]@(4,8,12));',
            "$publicArray=[System.UInt64[]]@(4,8,12);[Console]::Out.WriteLine('DEC_CAST_COMPLETE|'+$publicArray.Length);[Console]::Out.WriteLine('DEC_COMMAND_VISIBLE|'+([bool](Get-Command -Name New-Bytes -CommandType Function -ErrorAction SilentlyContinue)));$bytes=New-Bytes $width $publicArray;")

    # Read-only public probe only: emit fixed stage names before the failing
    # width-4 source-vector builder; no inner exception, handle or path values.
    body=once(body,'function Put-Pointer([byte[]]$Buffer,[int]$Offset,[System.UInt64]$Value,[int]$Width){',
        "function Put-Pointer([byte[]]$Buffer,[int]$Offset,[System.UInt64]$Value,[int]$Width){[Console]::Out.WriteLine('DEC_PUT_ENTER|'+$Width);")
    body=once(body,'[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width)}',
        "[Console]::Out.WriteLine('DEC_BEFORE_COPY|'+$Width);[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width);[Console]::Out.WriteLine('DEC_AFTER_COPY|'+$Width)}")
    body=once(body,'function New-Bytes([int]$Width,[System.UInt64[]]$Values){',
        "function New-Bytes([int]$Width,[System.UInt64[]]$Values){[Console]::Out.WriteLine('DEC_NEW_ENTER|'+$Width);")
    body=once(body,'Put-Pointer $buffer 0 ([System.UInt64]$Values.Count) $Width;',
        "[Console]::Out.WriteLine('DEC_BEFORE_COUNT|'+$Width);Put-Pointer $buffer 0 ([System.UInt64]$Values.Count) $Width;[Console]::Out.WriteLine('DEC_AFTER_COUNT|'+$Width);")
    body=once(body,'Put-Pointer $buffer ($header+$stride*$i) $Values[$i] $Width',
        "[Console]::Out.WriteLine('DEC_BEFORE_ITEM|'+$Width);Put-Pointer $buffer ($header+$stride*$i) $Values[$i] $Width;[Console]::Out.WriteLine('DEC_AFTER_ITEM|'+$Width)")
    if renamed:
        # Preserve original test vectors and failure controls, change only the
        # local helper command name after instrumenting the function body.
        body=body.replace('New-Bytes','New-PublicSnapshotBytes')
    script=r'''param([string]$Fixture)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$stage='PARSE'
try{
 $t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Fixture,[ref]$t,[ref]$e);if($e.Count){throw 'PARSE'}
 $f=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-PublicWindowsEofActorSource'},$true));if($f.Count -ne 1){throw 'SOURCE'}
 .([scriptblock]::Create($f[0].Extent.Text));$source=Get-PublicWindowsEofActorSource;$stage='COMPILE'
 $r=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory();Add-Type -TypeDefinition $source -ReferencedAssemblies @((Join-Path $r 'System.Runtime.Serialization.dll'),(Join-Path $r 'System.Xml.dll')) -ErrorAction Stop
 $stage='VECTOR';[Console]::Out.WriteLine('DEC_NATIVE_WIDTH|'+[IntPtr]::Size)
 $body=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__BODY__'));$v=&([scriptblock]::Create($body)) -Fixture $Fixture
 [Console]::Out.WriteLine('DEC_COMPLETE')
}catch{
 $type=$_.Exception.GetBaseException().GetType().Name;$known=@('ArgumentException','RuntimeException','MethodException','MethodInvocationException','PSInvalidCastException','InvalidCastException','OverflowException','InvalidOperationException','MissingMethodException');if($known -cnotcontains $type){$type='OTHER'}
 $code='UNKNOWN';$fqid=[string]$_.FullyQualifiedErrorId;if($fqid -match '\A[A-Za-z][A-Za-z0-9_]{0,71}\z'){$code=$fqid}
 [Console]::Out.WriteLine('DEC_FAILURE|'+$stage+'|'+$type+'|'+$code+'|'+[int]$_.Exception.GetBaseException().HResult)
 exit 1
}
'''.replace('__BODY__',base64.b64encode(body.encode()).decode())
    p=out/'decoder.ps1';p.write_text(script,encoding='utf8')
    shell=os.path.join(os.environ['SystemRoot'],'System32','WindowsPowerShell','v1.0','powershell.exe')
    r=subprocess.run([shell,'-NoProfile','-NonInteractive','-File',str(p),'-Fixture',str(Path(FIXTURE).resolve())],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=30)
    return {'exit':r.returncode,'rows':[x for x in r.stdout.splitlines() if re.fullmatch(r'DEC_[A-Z_]+(?:\|[A-Za-z0-9_.\[\]-]{1,80})*',x)]}


def writer_parent(fixture, test_source, out, exact_load=False, snapshot_origin=False, identity_accept=False):
    """Classify original CreateNew and a temporary actor-local type-origin candidate."""
    if snapshot_origin:
        fixture=once(fixture,
            'typeof(PublicWindowsEofActor).Assembly.Location',
            'typeof(PublicEofOwnHandleSnapshot).Assembly.Location')
    outer=re.search(r" \$publicWindowsEofActorControls=@'\r?\n([\s\S]*?)\r?\n'@",fixture)
    if outer is None: raise ValueError('PUBLIC_CONTROLS_ANCHOR_REQUIRED')
    controls=outer.group(1)
    embedded=re.search(r"\$writerParentContract=\[Text.Encoding\]::UTF8.GetString\(\[Convert\]::FromBase64String\('([^']+)'\)\)",controls)
    if embedded is None: raise ValueError('WRITER_CONTRACT_ANCHOR_REQUIRED')
    original=base64.b64decode(embedded.group(1),validate=True).decode()
    expected="if($writer -isnot [IO.FileStream] -or $writer.Name -cne $path -or $writer.Length -ne 0){throw 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED'}"
    observed="""$isWriter=($writer -is [IO.FileStream]);$strictPath=$false;$loosePath=$false;$empty=$false
 $sameDirectory=$false;$baseClass='NONE';if($isWriter){$strictPath=([string]::Equals($writer.Name,$path,[StringComparison]::Ordinal));$loosePath=([string]::Equals($writer.Name,$path,[StringComparison]::OrdinalIgnoreCase));$empty=($writer.Length -eq 0);$sameDirectory=[string]::Equals([IO.Path]::GetDirectoryName($writer.Name),[IO.Path]::GetDirectoryName($path),[StringComparison]::OrdinalIgnoreCase);$basename=[IO.Path]::GetFileName($writer.Name);if($basename -ceq 'actor-stdout-observation.json'){$baseClass='STDOUT'}elseif($basename -ceq 'actor-stderr-observation.json'){$baseClass='STDERR'}else{$baseClass='OTHER'}}
 $writerDir=if($isWriter){[IO.Path]::GetDirectoryName($writer.Name)}else{''}
 $typeLocation=try{[IO.Path]::GetDirectoryName($type.Assembly.Location)}catch{''}
 $typeCodeBase=try{[IO.Path]::GetDirectoryName(([Uri]$type.Assembly.CodeBase).LocalPath)}catch{''}
 $actorLocation=try{[IO.Path]::GetDirectoryName([PublicWindowsEofActor].Assembly.Location)}catch{''}
 $eq=[StringComparison]::OrdinalIgnoreCase
 $matchesWriterLocation=$isWriter -and [string]::Equals($writerDir,$typeLocation,$eq)
 $matchesWriterCodebase=$isWriter -and [string]::Equals($writerDir,$typeCodeBase,$eq)
 $matchesExpectedLocation=[string]::Equals([IO.Path]::GetDirectoryName($path),$typeLocation,$eq)
 $matchesExpectedCodebase=[string]::Equals([IO.Path]::GetDirectoryName($path),$typeCodeBase,$eq)
 $matchesExpectedActor=[string]::Equals([IO.Path]::GetDirectoryName($path),$actorLocation,$eq)
 $expectedExists=[IO.File]::Exists($path)
 $actualExists=$isWriter -and [IO.File]::Exists($writer.Name)
 $fileIdentity='UNKNOWN';$identityReader=$null
 try{
  if($isWriter -and $expectedExists){
   $identitySource=@'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
[StructLayout(LayoutKind.Sequential)] public struct PublicFt20261108 { public uint Low; public uint High; }
[StructLayout(LayoutKind.Sequential)] public struct PublicHandleInfo20261108 {
 public uint Attributes;
 public PublicFt20261108 Created;
 public PublicFt20261108 Accessed;
 public PublicFt20261108 Modified;
 public uint Volume;
 public uint FileSizeHigh;
 public uint FileSizeLow;
 public uint Links;
 public uint IndexHigh;
 public uint IndexLow;
}
public static class PublicFileIdentityProbe20261108 {
 [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
 [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out PublicHandleInfo20261108 info);
 public static int Compare(SafeFileHandle a,SafeFileHandle b){
  PublicHandleInfo20261108 x,y;
  if(a==null||b==null||a.IsInvalid||b.IsInvalid||!GetFileInformationByHandle(a,out x)||!GetFileInformationByHandle(b,out y))return -1;
  if(x.Volume==y.Volume && x.IndexHigh==y.IndexHigh && x.IndexLow==y.IndexLow && (x.IndexHigh!=0||x.IndexLow!=0))return 1;
  return 0;
 }
}
'@
   if(-not ('PublicFileIdentityProbe20261108' -as [type])){$null=Add-Type -TypeDefinition $identitySource -ErrorAction Stop}
   $identityReader=[IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);[Console]::Out.WriteLine('WRITER_READOPEN|YES')
   $sameFile=[PublicFileIdentityProbe20261108]::Compare($writer.SafeFileHandle,$identityReader.SafeFileHandle)
   if($sameFile -eq 1){$fileIdentity='MATCH'}elseif($sameFile -eq 0){$fileIdentity='DIFFERENT'}
  }
 }catch{}finally{if($identityReader){$identityReader.Dispose()}}
 [Console]::Out.WriteLine('WRITER_IDENTITY|'+$fileIdentity)
 foreach($diag in @(@('LOCATION_WRITER',$matchesWriterLocation),@('CODEBASE_WRITER',$matchesWriterCodebase),@('LOCATION_EXPECTED',$matchesExpectedLocation),@('CODEBASE_EXPECTED',$matchesExpectedCodebase),@('ACTOR_EXPECTED',$matchesExpectedActor),@('EXPECTED_EXISTS',$expectedExists),@('ACTUAL_EXISTS',$actualExists))){[Console]::Out.WriteLine('WRITER_'+$diag[0]+'|'+$(if($diag[1]){'YES'}else{'NO'}))}
 [Console]::Out.WriteLine('WRITER_TYPE|'+$(if($isWriter){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_PATH|'+$(if($strictPath){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_PATH_CASELESS|'+$(if($loosePath){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_EMPTY|'+$(if($empty){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_DIRECTORY|'+$(if($sameDirectory){'YES'}else{'NO'}));[Console]::Out.WriteLine('WRITER_BASENAME|'+$baseClass)
 """+expected
    revised=once(original,expected,observed)
    if identity_accept:
        # One-time DISPOSABLE comparison only: retain FileStream, zero-length,
        # CreateNew, foreign preservation, source-hash and all real test guards.
        # A Windows Volume/FileIndex match is mandatory when textual names differ.
        stronger="if($writer -isnot [IO.FileStream] -or (($writer.Name -cne $path) -and $fileIdentity -cne 'MATCH') -or $writer.Length -ne 0){throw 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED'}"
        revised=once(revised,expected,stronger)
    if exact_load:
        # Bind the exact compiled artifact, not a PowerShell type-name cache.
        revised=once(revised,'$assembly=[PublicWindowsEofActor].Assembly;',
            '$assembly=[Reflection.Assembly]::LoadFile($assemblyPath);')
    controls=once(controls,embedded.group(0),embedded.group(0).replace(embedded.group(1),base64.b64encode(revised.encode()).decode()))
    updated_fixture=once(fixture,outer.group(0),outer.group(0).replace(outer.group(1),controls))
    marker="if(child.error!==undefined||child.status!==0||child.stderr!=='')console.log('GORIQ_PUBLIC_EOF_DATA_CONTROL_FAILURE '"
    prelude="if(child.stdout){const safe=child.stdout.split(/\\r?\\n/).filter(v=>/^WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)[|](?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)$/.test(v));if(safe.length)console.log('WRITER_SAFE_STAGES '+JSON.stringify(safe))}"
    # Only in the disposable diagnostics checkout: strip OUR added WRITER_*
    # lines before passing stdout to the unchanged original JSON/parser/assertions.
    # No real actor line, negative assertion, wire data or expected value is dropped.
    if identity_accept:
        scrub=("if(child.stdout){const lines=child.stdout.split(/\\r?\\n/);"
               "child.stdout=lines.filter(v=>!/^WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)[|](?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)$/.test(v)).join('\\n');}")
        prelude=prelude+scrub
    updated_test=once(test_source,marker,prelude+marker)
    Path(FIXTURE).write_text(updated_fixture,encoding='utf8')
    Path(TEST).write_text(updated_test,encoding='utf8')
    r=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern=^public Windows EOF actor compiles as data',TEST],
        capture_output=True,text=True,encoding='utf8',errors='replace',timeout=40)
    matches=re.findall(r'WRITER_(?:TYPE|PATH|PATH_CASELESS|EMPTY|DIRECTORY|BASENAME|LOCATION_WRITER|CODEBASE_WRITER|LOCATION_EXPECTED|CODEBASE_EXPECTED|ACTOR_EXPECTED|EXPECTED_EXISTS|ACTUAL_EXISTS|IDENTITY|READOPEN)\|(?:YES|NO|STDOUT|STDERR|OTHER|NONE|MATCH|DIFFERENT|UNKNOWN)',r.stdout)
    observed_failure=re.search(r'GORIQ_PUBLIC_EOF_DATA_CONTROL_FAILURE (\{[^\r\n]+\})',r.stdout+"\n"+r.stderr)
    failure=None
    if observed_failure:
        try:
            record=json.loads(observed_failure.group(1))
            failure={k:record.get(k) for k in ('phase','code','category','nativeAuthority')}
        except ValueError: failure={'code':'UNPARSEABLE_PUBLIC_ENUM'}
    failure_kind='UNKNOWN'
    if r.returncode == 0: failure_kind='NONE'
    elif 'Unexpected token' in r.stdout or 'SyntaxError' in r.stdout: failure_kind='JSON_PARSE'
    elif 'AssertionError' in r.stdout or 'ERR_ASSERTION' in r.stdout: failure_kind='ASSERTION'
    elif 'ACTUAL_SOURCE_CREATE_NEW_REQUIRED' in r.stdout: failure_kind='CREATE_NEW'
    elif 'PUBLIC_' in r.stdout: failure_kind='PUBLIC_CONTRACT'
    return {'exit':r.returncode,'predicates':sorted(set(matches)), 'observed_predicate_count':len(matches), 'public_failure':failure, 'test_failure_kind':failure_kind}


def main():
    if sys.argv[1:]!=['--run'] or os.environ.get('GITHUB_REPOSITORY')!='haji84/AI-' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or os.name!='nt': raise ValueError('HOSTED_WINDOWS_REQUIRED')
    for p,h in EXPECTED.items():
        if subprocess.check_output(['git','hash-object',p],text=True).strip()!=h: raise ValueError('SOURCE_DRIFT')
    out=Path(os.environ['RUNNER_TEMP'])/'pr1905-fixture-stage2';out.mkdir(exist_ok=False)
    data={p:Path(p).read_bytes() for p in EXPECTED};report={'schema':'PR1905_STAGE2_V1','production_accepted':False,'source_changed':False}
    try:
        report['decoder']=decoder(data[FIXTURE].decode(),out)
        report['decoder_explicit_values']=decoder(data[FIXTURE].decode(),out,True)
        report['decoder_renamed']=decoder(data[FIXTURE].decode(),out,False,True)
        report['writer_parent']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_exact_load']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_snapshot_origin']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,False,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        report['writer_parent_identity_candidate']=writer_parent(data[FIXTURE].decode(),data[TEST].decode(),out,False,False,True)
        for p,b in data.items(): Path(p).write_bytes(b)
        Path(NATIVE).write_bytes(annotate_native(data[NATIVE].decode()).encode())
        Path(FIXTURE).write_bytes(annotate_fixture(data[FIXTURE].decode()).encode())
        source=data[TEST].decode()
        source=source.replace("assert.equal(child.error,undefined);assert.equal(child.status,0", "if(child.stderr){const safe=child.stderr.split(/\\r?\\n/).filter(x=>/^(?:PIPE_(?:GUARD_[0-9]{2}|CATCH_[0-9]{2}|OUTER)|JOB_NATIVE_STAGE)(?:\\|[A-Za-z0-9_-]{1,180})*$/.test(x));if(safe.length)console.log('CLOSED_STAGE '+JSON.stringify(safe.slice(0,24)));}assert.equal(child.error,undefined);assert.equal(child.status,0")
        Path(TEST).write_bytes(source.encode())
        pattern='^(clock R2 refusal cleans|private original-State owned Job finite policy and cleanup group2|Windows private original-State Job contains|private owned Job thrown close)'
        start=time.monotonic();r=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
        rows=[]
        for line in r.stdout.splitlines():
            mark=line.find('CLOSED_STAGE ')
            if mark>=0:
                try: rows.extend(json.loads(line[mark+13:]))
                except (ValueError,TypeError): pass
        report['cleanup']={'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'fixed_stage_rows':rows[:100]}
        # Run the exact failed public fixture in a fresh isolated test process
        # with only original ownership checks plus original wrapper disposal.
        for p,b in data.items(): Path(p).write_bytes(b)
        Path(NATIVE).write_bytes(cleanup_wrapper_candidate(data[NATIVE].decode()).encode())
        pattern='^(private original-State owned Job finite policy and cleanup group2|clock R2 refusal cleans|Windows private original-State Job contains|private owned Job thrown close)'
        start=time.monotonic()
        v=subprocess.run(['node','--test','--test-concurrency=1','--test-name-pattern='+pattern,TEST],
                          capture_output=True,text=True,encoding='utf8',errors='replace',timeout=125)
        markers=sorted(set(re.findall(r'(?:CUTOVER_BOOTSTRAP_FIXTURE|PEER_FIXTURE|PUBLIC_CLOCK|JOB_WINDOWS)_[A-Z0-9_]{1,120}',v.stdout+v.stderr)))
        report['candidate_pipe_wrappers']={'exit':v.returncode,'seconds':round(time.monotonic()-start,3),'failure_codes':markers[:25]}
    finally:
        for p,b in data.items(): Path(p).write_bytes(b)
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    sys.exit(1)

if __name__=='__main__':main()
