param(
    [Parameter(Mandatory = $true)]
    [string]$InstalledApp,
    [switch]$RemoveDevelopmentData
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$developmentDir = Join-Path $projectRoot '.flowtype-data'
$developmentData = Join-Path $developmentDir 'flowtype-data.json'
$installedData = Join-Path $env:APPDATA 'FlowType\flowtype-data.json'
$backupRoot = Split-Path $projectRoot -Parent
$backupDir = Join-Path $backupRoot ('FlowType-data-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

if (!(Test-Path -LiteralPath $developmentData)) { throw "Development data not found: $developmentData" }
if (!(Test-Path -LiteralPath $installedData)) { throw "Installed data not found: $installedData" }
if (!(Test-Path -LiteralPath $InstalledApp)) { throw "Installed app not found: $InstalledApp" }

New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item -LiteralPath $developmentData -Destination (Join-Path $backupDir 'development-flowtype-data.json')
Copy-Item -LiteralPath $installedData -Destination (Join-Path $backupDir 'installed-flowtype-data.json')

Get-Process FlowType -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$old = Get-Content -Raw -Encoding utf8 $developmentData | ConvertFrom-Json
$current = Get-Content -Raw -Encoding utf8 $installedData | ConvertFrom-Json
$historyById = @{}
foreach ($item in @($old.history)) { $historyById[$item.id] = $item }
foreach ($item in @($current.history)) { $historyById[$item.id] = $item }
$mergedHistory = @($historyById.Values | Sort-Object { [datetime]$_.createdAt } -Descending)

foreach ($field in @('qwenApiKeyEncrypted', 'volcanoApiKeyEncrypted', 'volcanoAccessKeyEncrypted')) {
    if (!$current.settings.$field -and $old.settings.$field) { $current.settings.$field = $old.settings.$field }
}
$current.settings.dictionary = @(
    @($old.settings.dictionary) + @($current.settings.dictionary) |
        Where-Object { $_ } |
        Sort-Object -Unique
)

$payload = [ordered]@{ settings = $current.settings; history = $mergedHistory }
$json = $payload | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($installedData, $json, [System.Text.UTF8Encoding]::new($false))

$check = Get-Content -Raw -Encoding utf8 $installedData | ConvertFrom-Json
$expectedIds = @($mergedHistory | ForEach-Object { $_.id } | Sort-Object)
$actualIds = @($check.history | ForEach-Object { $_.id } | Sort-Object)
if (@($check.history).Count -ne $mergedHistory.Count) { throw 'Merged history count validation failed' }
if (Compare-Object $expectedIds $actualIds) { throw 'Merged history ID validation failed' }

$removedShortcuts = 0
if ($RemoveDevelopmentData) {
    $resolvedDevelopmentDir = (Resolve-Path -LiteralPath $developmentDir).Path
    $expectedDevelopmentDir = Join-Path $projectRoot '.flowtype-data'
    if ($resolvedDevelopmentDir -ne $expectedDevelopmentDir) {
        throw "Refusing to delete unexpected path: $resolvedDevelopmentDir"
    }

    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {
        foreach ($file in Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -ErrorAction SilentlyContinue) {
            $shortcut = $shell.CreateShortcut($file.FullName)
            if ($shortcut.TargetPath -match 'electron\.exe$' -and $shortcut.Arguments -like "*$projectRoot*") {
                Remove-Item -LiteralPath $file.FullName -Force
                $removedShortcuts += 1
            }
        }
    }
    Remove-Item -LiteralPath $resolvedDevelopmentDir -Recurse -Force
}

$app = Start-Process -FilePath $InstalledApp -PassThru
Start-Sleep -Seconds 5
$started = [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)

[pscustomobject]@{
    Backup = $backupDir
    MergedHistory = @($check.history).Count
    DevelopmentDataRemoved = !(Test-Path -LiteralPath $developmentDir)
    DevelopmentShortcutsRemoved = $removedShortcuts
    InstalledAppStarted = $started
    Provider = $check.settings.provider
    Shortcut = $check.settings.shortcut
} | Format-List
