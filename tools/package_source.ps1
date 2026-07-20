param(
  [string]$Version = "0.9.0"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$VersionText = $Version.Trim().TrimStart("v")
$VersionTag = "v$VersionText"
$OutputDir = Join-Path $RepoRoot "release\$VersionTag"
$OutputZip = Join-Path $OutputDir "Chill-with-Kiritan-$VersionTag-source.zip"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
if (Test-Path -LiteralPath $OutputZip) { Remove-Item -LiteralPath $OutputZip -Force }

# git archive only exports tracked files. Ignored local models, credentials,
# personal data, dependencies, build outputs, and release artifacts stay out.
# Producing zip directly also preserves Japanese filenames on Windows.
$Prefix = "Chill-with-Kiritan-$VersionTag-source/"
git -C $RepoRoot archive --format=zip --output=$OutputZip --prefix=$Prefix HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive failed." }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($OutputZip)
try {
  $forbidden = @($zip.Entries | Where-Object {
    $_.FullName -match '(?i)(\.vrm$|\.vrma$|\.env$|\.pem$|\.key$|\.keystore$|(^|/)(secrets\.json|companion-api-token\.txt)$)'
  })
  if ($forbidden.Count -gt 0) {
    throw "Source archive contains forbidden local/restricted files: $($forbidden.FullName -join ', ')"
  }
} finally {
  $zip.Dispose()
}

Write-Host "Clean source archive: $OutputZip"
