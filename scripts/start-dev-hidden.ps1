$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ElectronExe = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"

if (-not (Test-Path $ElectronExe)) {
  throw "Electron executable not found. Run npm install first."
}

Push-Location $ProjectRoot
try {
  Start-Process `
    -FilePath $ElectronExe `
    -ArgumentList "." `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden
} finally {
  Pop-Location
}
