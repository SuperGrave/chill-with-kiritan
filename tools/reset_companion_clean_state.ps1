param(
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

$DataDir = Join-Path $env:APPDATA "tohoku-companion"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $DataDir "backup-clean-reset-$Stamp"

$FilesToReset = @(
  "companion-data.json",
  "companion-data.json.bak",
  "secrets.json",
  "secrets.json.bak",
  "companion-api-token.txt",
  "companion-api-token.txt.tmp"
)

if (-not (Test-Path $DataDir)) {
  Write-Host "No Companion data directory exists:"
  Write-Host "  $DataDir"
  exit 0
}

$existing = $FilesToReset | ForEach-Object {
  $path = Join-Path $DataDir $_
  if (Test-Path $path) { $path }
}

if ($existing.Count -eq 0) {
  Write-Host "Companion data is already clean enough:"
  Write-Host "  $DataDir"
  exit 0
}

Write-Host "Companion clean reset target:"
Write-Host "  $DataDir"
Write-Host "Files to back up and remove:"
$existing | ForEach-Object { Write-Host "  $_" }
Write-Host "Backup directory:"
Write-Host "  $BackupDir"

if ($WhatIfOnly) {
  Write-Host "WhatIfOnly: no files changed."
  exit 0
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
foreach ($path in $existing) {
  Copy-Item -LiteralPath $path -Destination (Join-Path $BackupDir (Split-Path -Leaf $path)) -Force
}
foreach ($path in $existing) {
  Remove-Item -LiteralPath $path -Force
}

Write-Host "Clean reset complete."
Write-Host "Spotify credentials, memos, UI presets/settings, and local API token were removed from the active Companion data."
Write-Host "Personal news script folders were left untouched."
