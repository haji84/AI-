param(
  [string]$Repository = 'haji84/AI-'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) is required.'
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated.' }

$secure = Read-Host 'Groq API key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = ''
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Groq API key is empty.' }
  $plain | & gh secret set GROQ_API_KEY --repo $Repository
  if ($LASTEXITCODE -ne 0) { throw 'Failed to store GROQ_API_KEY in GitHub Actions secrets.' }
  Write-Host "GROQ_API_KEY stored as a GitHub Actions repository secret for $Repository."
  Write-Host 'The key was not written to the repository.'
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plain = $null
}
