param([ValidateSet('discover','stop','force-stop','launch')] [string]$Mode)
$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
$installRoot = if ($package -and $package.InstallLocation) { [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\') } else { $null }
$runtimeRoot = if ($env:LOCALAPPDATA) { [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'OpenAI\Codex')).TrimEnd('\') } else { $null }
$launcher = if ($env:CAM_LAUNCH_INFO) { $env:CAM_LAUNCH_INFO | ConvertFrom-Json } else { $null }
$launchInstallRoot = if ($launcher.installRoot -and [IO.Path]::IsPathRooted($launcher.installRoot)) {
  [IO.Path]::GetFullPath($launcher.installRoot).TrimEnd('\')
} else { $null }
# Keep the executable discovered before shutdown even if package registration changes.
$launchExecutable = if ($launcher.executable -and [IO.Path]::IsPathRooted($launcher.executable) -and
    [IO.Path]::GetFileName($launcher.executable) -in @('Codex.exe','ChatGPT.exe')) {
  [IO.Path]::GetFullPath($launcher.executable)
} else { $null }
$ownedRuntimes = @{}
$runtimeStateRoot = if ($env:CAM_DATA_ROOT) { [IO.Path]::GetFullPath($env:CAM_DATA_ROOT) } else {
  Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'codex-auth-manager'
}
$runtimeStatePath = Join-Path $runtimeStateRoot 'desktop-runtimes.json'
$runtimeRecords = @($env:CAM_OWNED_RUNTIMES)
if (Test-Path -LiteralPath $runtimeStatePath) { $runtimeRecords += [IO.File]::ReadAllText($runtimeStatePath) }
if ($runtimeRoot) {
  foreach ($json in $runtimeRecords) {
    if ([string]::IsNullOrWhiteSpace($json)) { continue }
    foreach ($record in (ConvertFrom-Json -InputObject $json)) {
      if ($record.pid -gt 0 -and $record.executable -and [string]$record.startTicks -match '^\d+$') {
        $recordPath = [IO.Path]::GetFullPath($record.executable)
        if ($recordPath.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
          $ownedRuntimes[[int]$record.pid] = @{ pid = [int]$record.pid; executable = $recordPath; startTicks = [string]$record.startTicks }
        }
      }
    }
  }
}
function Save-OwnedRuntimes([object[]]$records) {
  if (-not $records.Count) {
    if ([IO.File]::Exists($runtimeStatePath)) { [IO.File]::Delete($runtimeStatePath) }
    return
  }
  [void][IO.Directory]::CreateDirectory($runtimeStateRoot)
  $temporary = $runtimeStatePath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, (ConvertTo-Json -InputObject $records -Depth 3 -Compress), (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($runtimeStatePath)) { [IO.File]::Replace($temporary, $runtimeStatePath, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $runtimeStatePath) }
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
  }
}
function Get-Targets {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      $candidate = $_.Path
      if (-not $candidate) { return $false }
      $candidate = [IO.Path]::GetFullPath($candidate)
      if ($launchExecutable -and $candidate.Equals($launchExecutable, [StringComparison]::OrdinalIgnoreCase)) { return $true }
      if ($launchInstallRoot -and $candidate.StartsWith($launchInstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
      if ($installRoot -and $candidate.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
      if ($ownedRuntimes.ContainsKey($_.Id)) {
        $record = $ownedRuntimes[$_.Id]
        if ($candidate.Equals($record.executable, [StringComparison]::OrdinalIgnoreCase) -and
            $_.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.startTicks) { return $true }
      }
      return $runtimeRoot -and ($candidate -in @(
        ($runtimeRoot + '\Codex.exe'), ($runtimeRoot + '\ChatGPT.exe'),
        ($runtimeRoot + '\app\Codex.exe'), ($runtimeRoot + '\app\ChatGPT.exe')
      ))
    } catch { return $false }
  })
}
function Remember-OwnedRuntimes($roots) {
  if (-not $runtimeRoot -or -not @($roots | Where-Object { $_.Id }).Count) { return }
  # Updated desktop builds place their engines outside the MSIX directory.
  # Follow parent ownership, never target all codex.exe or node.exe processes.
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $owned = @{}
  foreach ($root in $roots) { $owned[[int]$root.Id] = $true }
  do {
    $changed = $false
    foreach ($entry in $processes) {
      if ($owned.ContainsKey([int]$entry.ParentProcessId) -and -not $owned.ContainsKey([int]$entry.ProcessId)) {
        $owned[[int]$entry.ProcessId] = $true
        $changed = $true
      }
    }
  } while ($changed)
  foreach ($entry in $processes) {
    if (-not $owned.ContainsKey([int]$entry.ProcessId) -or -not $entry.ExecutablePath) { continue }
    if (-not $entry.ExecutablePath.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    $target = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if ($target -and $target.Path -eq $entry.ExecutablePath) {
      $ownedRuntimes[[int]$target.Id] = @{ pid = $target.Id; executable = $target.Path; startTicks = $target.StartTime.ToUniversalTime().Ticks.ToString() }
    }
  }
}
if ($Mode -eq 'discover') {
  $startApp = Get-StartApps | Where-Object { $_.AppID -like 'OpenAI.Codex_*!App' } | Select-Object -First 1
  $appId = if ($startApp) { $startApp.AppID } elseif ($package) { $package.PackageFamilyName + '!App' } else { $null }
  $main = Get-Targets | Where-Object { $_.ProcessName -in @('Codex','ChatGPT') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $executable = if ($main) { $main.Path } else { $null }
  if (-not $appId -and -not $executable) { throw 'Cannot locate a supported Windows Codex desktop installation.' }
  $version = if ($package) { $package.Version.ToString() } elseif ($main) { $main.FileVersion } else { $null }
  @{ appId = $appId; executable = $executable; version = $version; installRoot = $installRoot; ownedRuntimes = @($ownedRuntimes.Values) } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}
if ($Mode -in @('stop','force-stop')) {
  $targets = @(Get-Targets)
  Remember-OwnedRuntimes $targets
  # Preserve ownership before closing its GUI parent, including manager interruption.
  Save-OwnedRuntimes @($ownedRuntimes.Values)
  $targets = @(Get-Targets)
  foreach ($target in $targets) {
    if ($Mode -eq 'force-stop') {
      # Explicitly confirmed only; targets are restricted to the Codex installation.
      try { $target.Kill() } catch { if (-not $target.HasExited) { throw } }
    } elseif ($target.MainWindowHandle -ne 0) { [void]$target.CloseMainWindow() }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (@(Get-Targets).Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  $remaining = @(Get-Targets)
  if ($remaining.Count -gt 0) {
    @{ status = 'still-running'; count = $remaining.Count; ownedRuntimes = @($ownedRuntimes.Values) } | ConvertTo-Json -Depth 4 -Compress
    exit 2
  }
  Save-OwnedRuntimes @()
  @{ status = 'stopped'; ownedRuntimes = @() } | ConvertTo-Json -Compress
  exit 0
}
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
