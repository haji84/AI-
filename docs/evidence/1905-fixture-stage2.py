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
EXPECTED={NATIVE:'d2fb7ab5af7f5f18d2463bd21a32a80fcf9f1678',FIXTURE:'2fb58be1e83ad9a9b19a6ec6ecf432e81f170b88',TEST:'af332cb501682da7ffede47eb560dec4ce9b41a4'}


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
    a='$bytes=New-Bytes $width ([ulong[]]@(4,8,12));$result=$type::Decode($bytes,$bytes.Length,$width,0,[ulong]4);'
    b="$bytes=New-Bytes $width ([ulong[]]@(4,8,12));[Console]::Out.WriteLine('DEC_VECTOR|'+$width+'|'+$bytes.Length+'|'+$bytes.GetType().FullName);$result=$type::Decode($bytes,$bytes.Length,$width,0,[ulong]4);[Console]::Out.WriteLine('DEC_RETURN|'+$width+'|'+$result.Count);"
    body=once(body,a,b)
    if explicit_values:
        body=once(body,'$bytes=New-Bytes $width ([ulong[]]@(4,8,12))',
            '$publicValues=[ulong[]]@([ulong]4,[ulong]8,[ulong]12);$bytes=New-Bytes -Width $width -Values $publicValues')
        body=once(body,'$b=New-Bytes $width $values',
            '$b=New-Bytes -Width $width -Values $values')
        body=once(body,'$valid=New-Bytes 8 ([ulong[]]@(4))',
            '$valid=New-Bytes -Width 8 -Values ([ulong[]]@([ulong]4))')
    body=once(body,'$t=$null;$e=$null;$ast=',"[Console]::Out.WriteLine('DEC_SCRIPT_ENTER');$t=$null;$e=$null;$ast=")
    body=once(body,'$source=Get-PublicWindowsEofActorSource',"$source=Get-PublicWindowsEofActorSource;[Console]::Out.WriteLine('DEC_SOURCE_OK')")
    body=once(body,"$type='PublicEofOwnHandleSnapshot' -as [type];", "[Console]::Out.WriteLine('DEC_TYPE_BEGIN');$type='PublicEofOwnHandleSnapshot' -as [type];")
    body=once(body,'$rows=@();$bad=@()',"[Console]::Out.WriteLine('DEC_FUNCTIONS_READY');$rows=@();$bad=@()")
    body=once(body,'foreach($width in @(4,8)){',"[Console]::Out.WriteLine('DEC_LOOP_READY');foreach($width in @(4,8)){[Console]::Out.WriteLine('DEC_LOOP_ENTER|'+$width);")

    # Read-only public probe only: emit fixed stage names before the failing
    # width-4 source-vector builder; no inner exception, handle or path values.
    body=once(body,'function Put-Pointer([byte[]]$Buffer,[int]$Offset,[ulong]$Value,[int]$Width){',
        "function Put-Pointer([byte[]]$Buffer,[int]$Offset,[ulong]$Value,[int]$Width){[Console]::Out.WriteLine('DEC_PUT_ENTER|'+$Width);")
    body=once(body,'[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width)}',
        "[Console]::Out.WriteLine('DEC_BEFORE_COPY|'+$Width);[Buffer]::BlockCopy($data,0,$Buffer,$Offset,$Width);[Console]::Out.WriteLine('DEC_AFTER_COPY|'+$Width)}")
    body=once(body,'function New-Bytes([int]$Width,[ulong[]]$Values){',
        "function New-Bytes([int]$Width,[ulong[]]$Values){[Console]::Out.WriteLine('DEC_NEW_ENTER|'+$Width);")
    body=once(body,'Put-Pointer $buffer 0 ([ulong]$Values.Count) $Width;',
        "[Console]::Out.WriteLine('DEC_BEFORE_COUNT|'+$Width);Put-Pointer $buffer 0 ([ulong]$Values.Count) $Width;[Console]::Out.WriteLine('DEC_AFTER_COUNT|'+$Width);")
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
 $code='UNKNOWN';foreach($k in @('MethodNotFound','MethodCountCouldNotFindBest','MethodArgumentConversionInvalidCastArgument','InvalidCastFromStringToInteger')){if($_.FullyQualifiedErrorId.StartsWith($k)){$code=$k}}
 [Console]::Out.WriteLine('DEC_FAILURE|'+$stage+'|'+$type+'|'+$code+'|'+[int]$_.Exception.GetBaseException().HResult)
 exit 1
}
'''.replace('__BODY__',base64.b64encode(body.encode()).decode())
    p=out/'decoder.ps1';p.write_text(script,encoding='utf8')
    shell=os.path.join(os.environ['SystemRoot'],'System32','WindowsPowerShell','v1.0','powershell.exe')
    r=subprocess.run([shell,'-NoProfile','-NonInteractive','-File',str(p),'-Fixture',str(Path(FIXTURE).resolve())],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=30)
    return {'exit':r.returncode,'rows':[x for x in r.stdout.splitlines() if re.fullmatch(r'DEC_[A-Z_]+(?:\|[A-Za-z0-9_.\[\]-]{1,80})*',x)]}


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
