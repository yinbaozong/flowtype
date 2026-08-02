$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$unpackedDir = Join-Path $projectRoot 'release\win-unpacked'
$appExe = Join-Path $unpackedDir 'FlowType.exe'
$output = Join-Path $projectRoot ("release\FlowType Portable {0}.zip" -f $package.version)

if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) {
  throw "Electron runtime not found: $electronExe"
}
if (-not (Test-Path -LiteralPath (Join-Path $unpackedDir 'resources\app.asar') -PathType Leaf)) {
  throw "Packaged application not found. Run electron-builder --win dir first."
}

# electron-builder edits the PE executable, producing an unknown hash that Smart
# App Control can reject. The portable build keeps Electron's original binary
# byte-for-byte and ships FlowType in the adjacent app.asar.
Copy-Item -LiteralPath $electronExe -Destination $appExe -Force

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}

Compress-Archive -Path (Join-Path $unpackedDir '*') -DestinationPath $output -CompressionLevel Optimal

$sourceHash = (Get-FileHash -LiteralPath $electronExe -Algorithm SHA256).Hash
$portableHash = (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash
if ($sourceHash -ne $portableHash) {
  throw 'Portable executable hash differs from the original Electron runtime.'
}

$archive = Get-Item -LiteralPath $output
Write-Output ("Portable package: {0}" -f $archive.FullName)
Write-Output ("Portable bytes: {0}" -f $archive.Length)
Write-Output ("Executable SHA256: {0}" -f $portableHash)
Write-Output ("Archive SHA256: {0}" -f (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash)
