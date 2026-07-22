param(
  [string]$OutputRoot,
  [string]$ZipName,
  [string]$ZipPath,
  [switch]$SkipBuild,
  [switch]$IncludeLocalVrmForPersonalUse
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$ReleaseRoot = Join-Path $RepoRoot "release"
$DefaultOutputRoot = Join-Path $ReleaseRoot "wallpaper-engine\Chill with Kiritan"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = $DefaultOutputRoot
}

function Resolve-ParentPath([string]$Path) {
  $parent = Split-Path -Parent $Path
  if ([string]::IsNullOrWhiteSpace($parent)) {
    $parent = "."
  }
  [System.IO.Path]::GetFullPath($parent)
}

function Assert-UnderPath([string]$Path, [string]$Parent, [string]$Label) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullParent = [System.IO.Path]::GetFullPath($Parent)
  if (-not $fullParent.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $fullParent += [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must stay under $fullParent, got $fullPath"
  }
}

$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$ReleaseRoot = [System.IO.Path]::GetFullPath($ReleaseRoot)
Assert-UnderPath $OutputRoot $ReleaseRoot "OutputRoot"

$WallpaperRoot = Join-Path $RepoRoot "01_wallpaper"
$DistRoot = Join-Path $WallpaperRoot "dist"
$StartGuideSource = Join-Path $RepoRoot "docs\START_GUIDE_JP.md"
$DistributionReadmeSource = Join-Path $RepoRoot "README_DISTRIBUTION_JP.md"
$DefaultZipName = if ($IncludeLocalVrmForPersonalUse) {
  "Chill-with-Kiritan-WallpaperEngine-local-personal.zip"
} else {
  "Chill-with-Kiritan-WallpaperEngine.zip"
}
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  if ([string]::IsNullOrWhiteSpace($ZipName)) {
    $ZipName = $DefaultZipName
  }
  $ZipPath = Join-Path $ReleaseRoot $ZipName
} elseif (-not [System.IO.Path]::IsPathRooted($ZipPath)) {
  $ZipPath = Join-Path $ReleaseRoot $ZipPath
}
$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)
Assert-UnderPath $ZipPath $ReleaseRoot "ZipPath"

if (-not $SkipBuild) {
  Push-Location $WallpaperRoot
  try {
    npm run build
    npm run check:dist-assets
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $DistRoot)) {
  throw "Wallpaper dist not found: $DistRoot"
}

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ZipPath) | Out-Null
if (Test-Path $OutputRoot) {
  Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

Copy-Item -Path (Join-Path $DistRoot "*") -Destination $OutputRoot -Recurse -Force
if (Test-Path $StartGuideSource) {
  Copy-Item -LiteralPath $StartGuideSource -Destination (Join-Path $OutputRoot "START_GUIDE_JP.md") -Force
}
if (Test-Path $DistributionReadmeSource) {
  Copy-Item -LiteralPath $DistributionReadmeSource -Destination (Join-Path $OutputRoot "README_DISTRIBUTION_JP.md") -Force
}

$project = [ordered]@{
  title = "Chill with Kiritan"
  type = "web"
  file = "index.html"
  preview = "preview.svg"
  description = "A local web wallpaper for Wallpaper Engine. Companion runs separately for live data, settings, Spotify, memo, and personal news."
  tags = @("Anime", "Technology")
  # Required for wallpaperRegisterAudioListener (SPECTRUM panel) to receive
  # audio frames. WE can auto-detect and add this, but the generated
  # project.json must declare it explicitly since users never open the editor.
  general = [ordered]@{
    supportsaudioprocessing = $true
    properties = [ordered]@{}
  }
}
$project | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputRoot "project.json") -Encoding UTF8

@'
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#171717"/>
  <rect x="42" y="42" width="360" height="140" rx="12" fill="#302c27" stroke="#5a5046"/>
  <rect x="640" y="46" width="250" height="330" rx="12" fill="#29241f" stroke="#5a5046"/>
  <rect x="42" y="410" width="250" height="88" rx="10" fill="#24211d" stroke="#5a5046"/>
  <rect x="320" y="410" width="250" height="88" rx="10" fill="#24211d" stroke="#5a5046"/>
  <rect x="596" y="410" width="322" height="88" rx="10" fill="#24211d" stroke="#5a5046"/>
  <text x="62" y="112" fill="#f4f4ee" font-family="Segoe UI, sans-serif" font-size="42" font-weight="700">Chill with Kiritan</text>
  <text x="62" y="154" fill="#c7bfb4" font-family="Segoe UI, sans-serif" font-size="22">Wallpaper Engine Web Package</text>
  <text x="666" y="92" fill="#f4f4ee" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700">NEWS</text>
  <text x="618" y="464" fill="#f4f4ee" font-family="Segoe UI, sans-serif" font-size="25" font-weight="700">PERSONAL NEWS</text>
</svg>
'@ | Set-Content -LiteralPath (Join-Path $OutputRoot "preview.svg") -Encoding UTF8

@'
# Chill with Kiritan - Wallpaper Engine Package

This folder is generated from `01_wallpaper/dist` for Wallpaper Engine.

## Start Here

For the current installation, update, backup, Spotify, personal-news, and BPM instructions, read:

- `README_DISTRIBUTION_JP.md`: quick Japanese installation guide
- `START_GUIDE_JP.md`: full Japanese manual

## Import into Wallpaper Engine

1. Open Wallpaper Engine.
2. Use "Open from File" or "Create Wallpaper" for a web wallpaper.
3. Select this folder's `project.json`. It enables audio processing for the spectrum panel.
4. Use `index.html` only if your Wallpaper Engine environment cannot select `project.json`, then allow audio input manually.
5. Run `Tohoku Companion` separately if you want live weather, news, Spotify, memos, settings, or personal news.

Companion includes four UI presets: standard and spectrum layouts for both 1920x1080 and 1920x1200.

## VRM Model

Shareable packages intentionally omit `models/kiritan.vrm`.
The preferred local setup is:

1. Start Tohoku Companion.
2. Open `STUDIO > 3D Model`.
3. Choose your own `.vrm` file.

The wallpaper tries to load the selected model. Bone, expression, motion, and prop compatibility vary by model.

The legacy default-model route is also available. Copy your own `kiritan.vrm` to the actual folder loaded by Wallpaper Engine:

```text
models/kiritan.vrm
```

The package script can do this only for your own machine with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/package_wallpaper_engine.ps1 -IncludeLocalVrmForPersonalUse
```

Do not redistribute a package that contains `models/kiritan.vrm`.

If this folder contains `LOCAL_PERSONAL_VRM_INCLUDED.txt`, it is already a
personal local package and must stay on your own machine.

## Clean Data

This package does not include Companion app data, Spotify credentials, memos, API keys, or user presets.
Companion stores local data under `%APPDATA%\tohoku-companion`.

Use `SYSTEM > Data / Backup` to export settings, presets, memos, links, timer state, and personal-news playback state. Background files, VRM files, personal-news scripts, and the downloaded lyrics cache are not embedded in that JSON backup.
'@ | Set-Content -LiteralPath (Join-Path $OutputRoot "README_WALLPAPER_ENGINE.md") -Encoding UTF8

$localVrm = Join-Path $WallpaperRoot "public\models\kiritan.vrm"
$packageVrm = Join-Path $OutputRoot "models\kiritan.vrm"
if ($IncludeLocalVrmForPersonalUse) {
  if (-not (Test-Path $localVrm)) {
    throw "Local VRM not found: $localVrm"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $packageVrm) | Out-Null
  Copy-Item -LiteralPath $localVrm -Destination $packageVrm -Force
  "LOCAL PERSONAL PACKAGE: includes models/kiritan.vrm. Do not redistribute." |
    Set-Content -LiteralPath (Join-Path $OutputRoot "LOCAL_PERSONAL_VRM_INCLUDED.txt") -Encoding UTF8
} elseif (Test-Path $packageVrm) {
  Remove-Item -LiteralPath $packageVrm -Force
}

$restrictedLeaks = Get-ChildItem -LiteralPath $OutputRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @(".vrm", ".vrma") }
if ($restrictedLeaks -and -not $IncludeLocalVrmForPersonalUse) {
  throw "Shareable package contains restricted model/motion files: $($restrictedLeaks.FullName -join ', ')"
}

if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $OutputRoot "*") -DestinationPath $ZipPath -Force

Write-Host "Wallpaper Engine package:"
Write-Host "  $OutputRoot"
Write-Host "Zip:"
Write-Host "  $ZipPath"
if ($IncludeLocalVrmForPersonalUse) {
  Write-Host "Local personal VRM was included. Do not redistribute this package."
} else {
  Write-Host "Shareable package is clean: no VRM included."
}
