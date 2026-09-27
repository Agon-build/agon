param(
  [string]$OutputPath = "frontend/public/downloads/agon-asp.zip"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = Join-Path $repoRoot ".agents/skills/agon-asp"
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "agon-asp-package"

if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
  throw "AGON skill source is missing: $source"
}

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $stage "agon-asp") -Force | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination (Join-Path $stage "agon-asp") -Recurse -Force
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Compress-Archive in Windows PowerShell writes backslash entry names, which
# macOS and Linux unzip as flat files. Write forward-slash names explicitly.
$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $stageRoot = (Resolve-Path -LiteralPath $stage).Path
  Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    $entry = $_.FullName.Substring($stageRoot.Length).TrimStart([char]92, [char]47).Replace([string][char]92, [string][char]47)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
if (-not (Test-Path -LiteralPath $output)) {
  throw "Skill archive was not created: $output"
}
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output "Created $output"
