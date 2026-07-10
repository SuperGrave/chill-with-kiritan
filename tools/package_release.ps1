param(
  # Omit to package the version the code actually declares (Cargo.toml).
  [string]$Version = "",
  [switch]$SkipWallpaperBuild,
  [switch]$SkipCompanionBuild,
  [switch]$IncludeLocalVrmForPersonalUse
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot

# ── Version consistency gate ──────────────────────────────────────────────────
# Cargo.toml is the canonical version (/api/health serves it). Everything else
# (three package.json + tauri.conf.json + the -Version argument, if given) must
# agree, so a release can never ship mixed version stamps.
$CargoTomlPath = Join-Path $RepoRoot "03_companion\src-tauri\Cargo.toml"
$cargoMatch = Select-String -LiteralPath $CargoTomlPath -Pattern '^version = "([^"]+)"' | Select-Object -First 1
if (-not $cargoMatch) { throw "Could not read package.version from $CargoTomlPath" }
$CanonicalVersion = $cargoMatch.Matches[0].Groups[1].Value

$VersionText = $Version.Trim()
if ([string]::IsNullOrWhiteSpace($VersionText)) {
  $VersionText = $CanonicalVersion
}

$versionMismatches = @()
if ($VersionText.TrimStart("v") -ne $CanonicalVersion) {
  $versionMismatches += "requested -Version $VersionText but Cargo.toml declares $CanonicalVersion"
}
foreach ($rel in @("01_wallpaper\package.json", "02_ui-overlay\package.json", "03_companion\package.json", "03_companion\src-tauri\tauri.conf.json")) {
  $json = Get-Content -LiteralPath (Join-Path $RepoRoot $rel) -Raw | ConvertFrom-Json
  if ($json.version -ne $CanonicalVersion) {
    $versionMismatches += "$rel = $($json.version)"
  }
}
if ($versionMismatches.Count -gt 0) {
  throw "Version stamps disagree with Cargo.toml ($CanonicalVersion):`n  " + ($versionMismatches -join "`n  ")
}

# ── cargo fmt gate ────────────────────────────────────────────────────────────
Push-Location (Join-Path $RepoRoot "03_companion\src-tauri")
try {
  cargo fmt --check
  if ($LASTEXITCODE -ne 0) { throw "cargo fmt --check failed - run 'cargo fmt' in 03_companion/src-tauri first." }
} finally {
  Pop-Location
}
$VersionTag = if ($VersionText.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
  $VersionText
} else {
  "v$VersionText"
}
$ReleaseRoot = Join-Path $RepoRoot "release\$VersionTag"
$CompanionRelease = Join-Path $ReleaseRoot "companion"
$WallpaperOutputRoot = Join-Path $ReleaseRoot "wallpaper-engine\Chill with Kiritan"
$StartGuideSource = Join-Path $RepoRoot "docs\START_GUIDE_JP.md"
$StartGuideRelease = Join-Path $ReleaseRoot "START_GUIDE_JP.md"
$DistributionReadmeSource = Join-Path $RepoRoot "README_DISTRIBUTION_JP.md"
$DistributionReadmeRelease = Join-Path $ReleaseRoot "README_DISTRIBUTION_JP.md"
$WallpaperZipName = if ($IncludeLocalVrmForPersonalUse) {
  "Chill-with-Kiritan-WallpaperEngine-$VersionTag-local-personal.zip"
} else {
  "Chill-with-Kiritan-WallpaperEngine-$VersionTag.zip"
}
$WallpaperZipPath = Join-Path $ReleaseRoot $WallpaperZipName
$ReleaseZipName = if ($IncludeLocalVrmForPersonalUse) {
  "Chill-with-Kiritan-$VersionTag-local-personal-release.zip"
} else {
  "Chill-with-Kiritan-$VersionTag-release.zip"
}
$ReleaseZipPath = Join-Path $ReleaseRoot $ReleaseZipName
$WallpaperModelNote = if ($IncludeLocalVrmForPersonalUse) {
  "This release was built for local personal use and includes ``models/kiritan.vrm``. Do not redistribute the wallpaper folder or local-personal zip."
} else {
  "The shareable Wallpaper Engine package does not include ``models/kiritan.vrm`` or ``.vrma`` files. Copy your own VRM into the imported Wallpaper Engine folder for local personal use only."
}

$wallpaperArgs = @{
  OutputRoot = $WallpaperOutputRoot
  ZipPath = $WallpaperZipPath
}
if ($SkipWallpaperBuild) { $wallpaperArgs.SkipBuild = $true }
if ($IncludeLocalVrmForPersonalUse) { $wallpaperArgs.IncludeLocalVrmForPersonalUse = $true }

& (Join-Path $ScriptRoot "package_wallpaper_engine.ps1") @wallpaperArgs

if (Test-Path $StartGuideSource) {
  Copy-Item -LiteralPath $StartGuideSource -Destination $StartGuideRelease -Force
}
if (Test-Path $DistributionReadmeSource) {
  Copy-Item -LiteralPath $DistributionReadmeSource -Destination $DistributionReadmeRelease -Force
}

if (-not $SkipCompanionBuild) {
  Push-Location (Join-Path $RepoRoot "03_companion")
  try {
    npm run tauri -- build --bundles nsis
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Force -Path $CompanionRelease | Out-Null
Get-ChildItem -LiteralPath $CompanionRelease -File -Filter "Tohoku Companion_*_x64-setup.exe" -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

$candidateRoots = @(
  (Join-Path $RepoRoot "03_companion\src-tauri\target\release"),
  "C:\cargo-build\tohoku-companion\release"
)

$setup = $candidateRoots |
  ForEach-Object { Get-ChildItem -Path $_ -Recurse -Filter "Tohoku Companion_*_x64-setup.exe" -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$exe = $candidateRoots |
  ForEach-Object { Get-ChildItem -Path $_ -Recurse -Filter "tohoku-companion.exe" -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($setup) {
  Copy-Item -LiteralPath $setup.FullName -Destination $CompanionRelease -Force
} else {
  Write-Warning "Companion installer was not found."
}

if ($exe) {
  Copy-Item -LiteralPath $exe.FullName -Destination $CompanionRelease -Force
} else {
  Write-Warning "Companion exe was not found."
}

@"
# Chill with Kiritan $VersionTag Release

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## Wallpaper Engine

- Folder: `wallpaper-engine\Chill with Kiritan`
- Zip: ``$WallpaperZipName``

$WallpaperModelNote

## Companion

- Installer/exe: `companion\`

Companion stores live user data under `%APPDATA%\tohoku-companion`; this release
folder does not include Spotify credentials, memos, UI presets, API keys, or
other local user data.

## Start Guide

- Quick start: README_DISTRIBUTION_JP.md
- Japanese manual: START_GUIDE_JP.md
"@ | Set-Content -LiteralPath (Join-Path $ReleaseRoot "README_RELEASE.md") -Encoding UTF8

if (Test-Path $ReleaseZipPath) {
  Remove-Item -LiteralPath $ReleaseZipPath -Force
}
$archiveItems = @(
  $WallpaperOutputRoot,
  $WallpaperZipPath,
  $CompanionRelease,
  $DistributionReadmeRelease,
  $StartGuideRelease,
  (Join-Path $ReleaseRoot "README_RELEASE.md")
) | Where-Object { Test-Path -LiteralPath $_ }
Compress-Archive -LiteralPath $archiveItems -DestinationPath $ReleaseZipPath -Force

Write-Host "Release folder:"
Write-Host "  $ReleaseRoot"
Write-Host "Release zip:"
Write-Host "  $ReleaseZipPath"
