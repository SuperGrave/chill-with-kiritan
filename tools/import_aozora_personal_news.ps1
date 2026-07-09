param(
  [string]$OutputDir = "03_companion\personal_news_scripts",
  [int]$MaxChars = 2200,
  [switch]$KeepDownloads
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath([string]$Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }
  return Join-Path (Get-Location) $Path
}

function Remove-AozoraMarkup([string]$Text) {
  $body = $Text -replace "`r`n", "`n"
  $body = $body -replace "`r", "`n"
  $body = $body -replace "^\uFEFF", ""

  $lines = $body -split "`n"
  if ($lines.Length -gt 4) {
    $lines = $lines[2..($lines.Length - 1)]
  }

  $cleanLines = New-Object System.Collections.Generic.List[string]
  $skipGuideBlock = $false
  foreach ($line in $lines) {
    $trim = $line.Trim()
    if ($trim -match "テキスト中に現れる記号について") {
      $skipGuideBlock = $true
      continue
    }
    if ($skipGuideBlock) {
      if ($trim -match "^[-‐ー]+$") {
        $skipGuideBlock = $false
      }
      continue
    }
    if ($trim -match "^底本[:：]" -or $trim -match "^入力[:：]" -or $trim -match "^校正[:：]" -or $trim -match "青空文庫作成ファイル") {
      break
    }
    if ($trim -match "^[-‐ー]+$") { continue }
    if ($trim -eq "" -and $cleanLines.Count -eq 0) { continue }
    $cleanLines.Add($line)
  }

  $body = ($cleanLines -join "`n")
  $body = $body -replace "［＃.*?］", ""
  $body = $body -replace "《.*?》", ""
  $body = $body -replace "｜", ""
  $body = $body -replace "※", ""
  $body = $body -replace "[ 　]+", " "
  $body = $body -replace "`n{3,}", "`n`n"
  return $body.Trim()
}

function Split-JapaneseSentences([string]$Text, [int]$LimitChars) {
  $source = ($Text -replace "`n+", " ").Trim()
  $matches = [regex]::Matches($source, ".*?[。！？]|.+$")
  $sentences = New-Object System.Collections.Generic.List[string]
  $used = 0
  foreach ($match in $matches) {
    $s = $match.Value.Trim()
    if ($s.Length -eq 0) { continue }
    if ($used -ge $LimitChars) { break }
    if (($used + $s.Length) -gt $LimitChars -and $sentences.Count -gt 0) { break }
    $sentences.Add($s)
    $used += $s.Length
  }
  return $sentences
}

function Get-LineSeconds([string]$Sentence) {
  $seconds = 5.5 + ($Sentence.Length / 13.0)
  $seconds = [Math]::Max(5.0, [Math]::Min(14.0, $seconds))
  return "{0:0.0}" -f $seconds
}

function ConvertTo-PersonalNewsScript($Work, [string]$RawText, [int]$LimitChars) {
  $body = Remove-AozoraMarkup $RawText
  $sentences = Split-JapaneseSentences $body $LimitChars
  $lines = New-Object System.Collections.Generic.List[string]

  $lines.Add("# Title: 青空文庫 - $($Work.Title)")
  $lines.Add("# Description: $($Work.Author)『$($Work.Title)』を青空文庫から取り込んだ読書用サンプル原稿。")
  $lines.Add("# DefaultLineMs: 9000")
  $lines.Add("")
  $lines.Add("## Scenario")
  $lines.Add("[Topic: 01 $($Work.Topic)]")
  $lines.Add("[Supplement: 5.0 | 青空文庫 図書カード - $($Work.Title) | $($Work.CardUrl)]")

  $index = 0
  $chapter = 1
  foreach ($sentence in $sentences) {
    if ($index -gt 0 -and ($index % 6) -eq 0) {
      $chapter += 1
      $lines.Add("")
      $lines.Add("[Topic: {0:00} $($Work.Topic) 続き]" -f $chapter)
    }
    $seconds = Get-LineSeconds $sentence
    $safe = $sentence -replace "`n", " "
    $lines.Add("[Line: $seconds] $safe")
    $index += 1
  }

  return ($lines -join "`r`n") + "`r`n"
}

$works = @(
  @{
    Title = "夢十夜 第一夜"
    Author = "夏目漱石"
    Topic = "第一夜"
    CardUrl = "https://www.aozora.gr.jp/cards/000148/card799.html"
    ZipUrl = "https://www.aozora.gr.jp/cards/000148/files/799_ruby_6024.zip"
    OutputName = "aozora_夢十夜_第一夜.txt"
    MaxChars = 1800
  },
  @{
    Title = "羅生門 冒頭"
    Author = "芥川龍之介"
    Topic = "羅生門"
    CardUrl = "https://www.aozora.gr.jp/cards/000879/card127.html"
    ZipUrl = "https://www.aozora.gr.jp/cards/000879/files/127_ruby_150.zip"
    OutputName = "aozora_羅生門_冒頭.txt"
    MaxChars = 1900
  },
  @{
    Title = "走れメロス 冒頭"
    Author = "太宰治"
    Topic = "走れメロス"
    CardUrl = "https://www.aozora.gr.jp/cards/000035/card1567.html"
    ZipUrl = "https://www.aozora.gr.jp/cards/000035/files/1567_ruby_4948.zip"
    OutputName = "aozora_走れメロス_冒頭.txt"
    MaxChars = 1900
  },
  @{
    Title = "銀河鉄道の夜 冒頭"
    Author = "宮沢賢治"
    Topic = "銀河鉄道の夜"
    CardUrl = "https://www.aozora.gr.jp/cards/000081/card456.html"
    ZipUrl = "https://www.aozora.gr.jp/cards/000081/files/456_ruby_145.zip"
    OutputName = "aozora_銀河鉄道の夜_冒頭.txt"
    MaxChars = 2200
  }
)

$outputPath = Resolve-RepoPath $OutputDir
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aozora-personal-news-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  foreach ($work in $works) {
    $zipPath = Join-Path $tempRoot ([System.IO.Path]::GetFileName($work.ZipUrl))
    $extractDir = Join-Path $tempRoot ([System.IO.Path]::GetFileNameWithoutExtension($zipPath))
    Invoke-WebRequest -UseBasicParsing -Uri $work.ZipUrl -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $txt = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter "*.txt" | Select-Object -First 1
    if (-not $txt) {
      throw "No text file found in $zipPath"
    }
    $raw = [System.Text.Encoding]::GetEncoding(932).GetString([System.IO.File]::ReadAllBytes($txt.FullName))
    $limit = if ($work.ContainsKey("MaxChars")) { [int]$work.MaxChars } else { $MaxChars }
    $script = ConvertTo-PersonalNewsScript $work $raw $limit
    $dest = Join-Path $outputPath $work.OutputName
    [System.IO.File]::WriteAllText($dest, $script, [System.Text.UTF8Encoding]::new($false))
    Write-Host "wrote $dest"
  }
}
finally {
  if (-not $KeepDownloads -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
