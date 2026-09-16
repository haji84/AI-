param(
 [Parameter(Mandatory=$true)][string]$UnsignedApk,
 [Parameter(Mandatory=$true)][string]$BaselineApk,
 [Parameter(Mandatory=$true)][string]$Keystore,
 [Parameter(Mandatory=$true)][string]$PasswordFile,
 [Parameter(Mandatory=$true)][string]$ApkSigner,
 [Parameter(Mandatory=$true)][string]$Aapt,
 [Parameter(Mandatory=$true)][string]$OutputApk,
 [Parameter(Mandatory=$true)][int]$ExpectedVersionCode,
 [switch]$Sign
)
$ErrorActionPreference='Stop'
# Never create/rotate a key, uninstall an app, or publish from this helper.
foreach($p in @($UnsignedApk,$BaselineApk,$Keystore,$PasswordFile,$ApkSigner,$Aapt)) {
 if(!(Test-Path -LiteralPath $p -PathType Leaf)){throw 'Required signing input is missing'}
}
if(Test-Path -LiteralPath $OutputApk){throw 'Output already exists; refusing overwrite'}
function Identity([string]$file) {
 $lines = & $Aapt dump badging $file 2>&1
 if($LASTEXITCODE -ne 0){throw 'APK metadata inspection failed'}
 $line = $lines | Where-Object {$_ -match "^package: name='([^']+)' versionCode='([0-9]+)'"} | Select-Object -First 1
 if(!$line -or $line -notmatch "^package: name='([^']+)' versionCode='([0-9]+)'"){throw 'Missing APK identity'}
 return @{package=$Matches[1];version=[long]$Matches[2]}
}
function Signers([string]$file) {
 $lines = & $ApkSigner verify --print-certs $file 2>&1
 if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
 $digests = @($lines | ForEach-Object {if($_ -match '^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]+)$'){$Matches[1].ToLowerInvariant()}} | Sort-Object -Unique)
 if($digests.Count -eq 0){throw 'Missing APK signer'}
 return $digests -join ','
}
$baseline=Identity $BaselineApk
$candidate=Identity $UnsignedApk
if($baseline.package -ne 'ai.jarvis.worker' -or $candidate.package -ne $baseline.package -or
   $candidate.version -ne $ExpectedVersionCode -or $candidate.version -le $baseline.version){throw 'Package/version mismatch or downgrade'}
$expectedSigner=Signers $BaselineApk
if(!$Sign){Write-Output 'Inputs verified. No APK signed; use -Sign after approving the exact artifact.';exit 0}
$tempOutput=$OutputApk+'.candidate-'+[guid]::NewGuid().ToString('N')
try {
 # Password is read by apksigner from the existing file, never passed as text or logged.
 $null = & $ApkSigner sign --ks $Keystore --ks-key-alias jarvis-worker --ks-pass ('file:'+$PasswordFile) --key-pass ('file:'+$PasswordFile) --out $tempOutput $UnsignedApk 2>&1
 if($LASTEXITCODE -ne 0){throw 'Signing failed; verify existing key/password locally'}
 if((Signers $tempOutput) -ne $expectedSigner){throw 'Existing Android signer mismatch; artifact will not be published'}
 Move-Item -LiteralPath $tempOutput -Destination $OutputApk
 [pscustomobject]@{status='SIGNED_NOT_PUBLISHED';versionCode=$candidate.version;sha256=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash;signer=$expectedSigner}
} finally {
 # Delete only this invocation's disposable candidate, never supplied inputs.
 if(Test-Path -LiteralPath $tempOutput){Remove-Item -LiteralPath $tempOutput}
}
