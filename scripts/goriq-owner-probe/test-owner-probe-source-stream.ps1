Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$streamChecks=0
function Assert-SourceFrame([string]$Name,[byte[]]$Frame,[string]$Expected,[string]$Reason='') {
 $stream=[IO.MemoryStream]::new($Frame)
 $value=$null;$actual=''
 try {$value=Read-OwnerProbeNativeSource -InputStream $stream}catch{$actual=$_.Exception.Message}
 finally{$stream.Dispose()}
 if($Reason){if($actual -cne $Reason){throw ('SOURCE_FRAME_REFUSAL:'+ $Name+':'+$actual)}}
 elseif($actual -or $value -cne $Expected){throw ('SOURCE_FRAME_ROUNDTRIP:'+ $Name)}
 $script:streamChecks++;Write-Output ('PASS source_frame_'+$Name)
}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))
$source+="`n// public Unicode fixture: "+[char]0x6f22+[char]0x5b57
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))+"`n"
$encodings=@(
 [Text.UTF8Encoding]::new($false),[Text.UTF8Encoding]::new($true),
 [Text.UnicodeEncoding]::new($false,$true),[Text.UnicodeEncoding]::new($true,$true),
 [Text.UTF32Encoding]::new($false,$true),[Text.UTF32Encoding]::new($true,$true),
 [Text.Encoding]::ASCII,[Text.Encoding]::GetEncoding(28591)
)
foreach($encoding in $encodings){
 $frame=[byte[]]($encoding.GetPreamble()+$encoding.GetBytes($encoded))
 Assert-SourceFrame ('encoding_'+$streamChecks) $frame $source
}
Assert-SourceFrame 'empty' ([byte[]]@()) '' 'NATIVE_SOURCE_EMPTY'
Assert-SourceFrame 'whitespace_only' ([Text.Encoding]::UTF8.GetBytes(" `n")) '' 'NATIVE_SOURCE_EMPTY'
Assert-SourceFrame 'malformed_base64' ([Text.Encoding]::UTF8.GetBytes("PUBLIC!`n")) '' 'NATIVE_SOURCE_BASE64_REJECTED'
Assert-SourceFrame 'invalid_source_utf8' ([Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String([byte[]]@(255,254,255))+"`n")) '' 'NATIVE_SOURCE_UTF8_REJECTED'
Assert-SourceFrame 'oversized_record' ([Text.Encoding]::UTF8.GetBytes(('A'*87385)+"`n")) '' 'NATIVE_SOURCE_OVERSIZED'
Assert-SourceFrame 'oversized_source' ([Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('a'*65537))+"`n")) '' 'NATIVE_SOURCE_OVERSIZED'
$boundary='a'*65536
Assert-SourceFrame 'source_limit_preserved' ([Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($boundary))+"`n")) $boundary
$sourceBom=[string][char]0xfeff+$source
Assert-SourceFrame 'source_content_bom_preserved' ([Text.Encoding]::UTF8.GetBytes([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sourceBom))+"`n")) $sourceBom
Write-Output ('SOURCE_STREAM_PASS='+$streamChecks)
