# Build the public Mog CLI + existing Calipers adapter, then capture on Windows.
param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
$previousMog = $env:MOG_BIN
Push-Location $root
try {
    if (!(Test-Path 'vendor/calipers/scripts/capture-recalculate.ps1')) {
        throw 'Initialize the pinned submodule first: git submodule update --init -- vendor/calipers'
    }
    & cargo build -p mog --locked --release --target-dir target-native
    if ($LASTEXITCODE -ne 0) { throw 'Mog build failed' }
    $env:MOG_BIN = Join-Path $root 'target-native/release/mog.exe'
    $adapter = Join-Path $root 'target-native/calipers-mog.exe'
    & go build -o $adapter ./scripts/calipers-mog/main.go
    if ($LASTEXITCODE -ne 0) { throw 'Calipers adapter build failed' }
    & ./vendor/calipers/scripts/capture-recalculate.ps1 -Engine $adapter
} finally {
    $env:MOG_BIN = $previousMog
    Pop-Location
}
