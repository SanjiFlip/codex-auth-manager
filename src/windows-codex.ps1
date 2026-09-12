param([ValidateSet('discover','stop','launch')] [string]$Mode)
$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
$installRoot = if ($package -and $package.InstallLocation) { [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\') } else { $null }
function Get-Targets {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      $candidate = $_.Path
      if (-not $candidate) { return $false }
      $candidate = [IO.Path]::GetFullPath($candidate)
      if ($installRoot -and $candidate.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
      return ($_.ProcessName -in @('Codex','ChatGPT')) -and ($candidate -like '*\OpenAI\Codex\*')
    } catch { return $false }
  })
}
if ($Mode -eq 'discover') {
  $startApp = Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*!App' } | Select-Object -First 1
  $appId = if ($startApp) { $startApp.AppID } elseif ($package) { $package.PackageFamilyName + '!App' } else { $null }
  $main = Get-Targets | Where-Object { $_.ProcessName -in @('Codex','ChatGPT') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $executable = if ($main) { $main.Path } else { $null }
  if (-not $appId -and -not $executable) { throw 'Cannot locate a supported Windows Codex desktop installation.' }
  @{ appId = $appId; executable = $executable } | ConvertTo-Json -Compress
  exit 0
}
if ($Mode -eq 'stop') {
  $targets = @(Get-Targets)
  foreach ($target in $targets) {
    if ($target.MainWindowHandle -ne 0) { [void]$target.CloseMainWindow() }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (@(Get-Targets).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (@(Get-Targets).Count -gt 0) { throw 'Codex is still running. Save your work and fully quit Codex, then try again.' }
  exit 0
}
$launcher = $env:CAM_LAUNCH_INFO | ConvertFrom-Json
if ($launcher.appId -and $launcher.appId -match '^OpenAI\.Codex_[A-Za-z0-9_]+!App$') {
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\' + $launcher.appId) -WindowStyle Hidden
} elseif ($launcher.executable -and (Test-Path -LiteralPath $launcher.executable)) {
  Start-Process -FilePath $launcher.executable -WindowStyle Hidden
} else { throw 'Codex launcher is unavailable.' }
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 300
  $started = @(Get-Targets | Where-Object { $_.ProcessName -in @('Codex','ChatGPT') })
} while ($started.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
if ($started.Count -eq 0) { throw 'Codex process startup could not be confirmed.' }
