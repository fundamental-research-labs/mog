# Verify Mog against the committed Windows Excel goldens for issue #401.
param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
$previousMog = $env:MOG_BIN
Push-Location $root
try {
    if (!(Test-Path 'vendor/calipers/verification/cases/recalculate/offset_controls/golden.xlsx')) {
        throw 'Initialize the pinned submodule first: git submodule update --init -- vendor/calipers'
    }
    & cargo build -p mog --locked --release --target-dir target-native
    if ($LASTEXITCODE -ne 0) { throw 'Mog build failed' }
    $env:MOG_BIN = Join-Path $root 'target-native/release/mog.exe'
    $adapter = Join-Path $root 'target-native/calipers-mog.exe'
    & go build -o $adapter ./scripts/calipers-mog/main.go
    if ($LASTEXITCODE -ne 0) { throw 'Calipers adapter build failed' }
    $calipers = Join-Path $root 'target-native/calipers.exe'
    Push-Location (Join-Path $root 'vendor/calipers')
    try {
        & go build -o $calipers ./cmd/calipers
        if ($LASTEXITCODE -ne 0) { throw 'Calipers build failed' }
        $verifyLog = Join-Path $root 'target-native/issue-401-verify.log'
        & $calipers verify --engine $adapter --suite recalculate --out-dir (Join-Path $root 'target-native/issue-401') | Tee-Object $verifyLog
        if ($LASTEXITCODE -ne 0) { throw 'OFFSET recalculation verification failed' }
        if (!(Select-String -Path $verifyLog -Pattern '^verify: 5 pass, 0 fail, 0 error$' -Quiet)) {
            throw 'Expected five passing cases; missing goldens or skipped cases are not a pass'
        }
    } finally {
        Pop-Location
    }
} finally {
    $env:MOG_BIN = $previousMog
    Pop-Location
}
