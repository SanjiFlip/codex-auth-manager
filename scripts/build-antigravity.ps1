$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceRoot = Join-Path $projectRoot 'src\antigravity'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$references = @('System.dll','System.Core.dll','System.Security.dll','System.Web.Extensions.dll','System.Management.dll') | ForEach-Object { '/reference:' + (Join-Path $framework $_) }
$sources = @(Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cs' | Select-Object -ExpandProperty FullName)
& (Join-Path $framework 'csc.exe') /nologo /target:exe /platform:x64 /optimize+ /utf8output ('/out:' + (Join-Path $sourceRoot 'AntigravityBridge.exe')) @references @sources
if ($LASTEXITCODE -ne 0) { throw 'Antigravity bridge build failed' }
