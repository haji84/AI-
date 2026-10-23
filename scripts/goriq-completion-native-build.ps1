# Invoked only by the scoped parent in its newly created private release directory.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if((Get-Location).Path -cnotmatch '^C:\\Users\\qq113\\JARVIS\\releases\\[a-f0-9]{40}$'){throw 'BUILD_ROOT_REJECTED'}
if((& node --version).Trim() -cne 'v24.19.0' -or (& pnpm --version).Trim() -cne '11.19.0'){throw 'BUILD_TOOLCHAIN_REJECTED'}
& pnpm install --offline --frozen-lockfile
if($LASTEXITCODE -ne 0){exit 1}
& pnpm build
exit $LASTEXITCODE
