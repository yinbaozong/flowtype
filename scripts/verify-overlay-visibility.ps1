param([string]$AppPath = "$PSScriptRoot\..\node_modules\electron\dist\electron.exe")

$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class FlowTypeOverlayVisibilityTest {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  struct RECT { public int left, top, right, bottom; }

  public static string Run(uint targetProcessId, bool expectedVisible) {
    IntPtr overlay = IntPtr.Zero;
    bool visible = false;
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      RECT rect;
      GetWindowRect(window, out rect);
      int width = rect.right - rect.left;
      int height = rect.bottom - rect.top;
      if (processId == targetProcessId && width >= 44 && width <= 280 && height > 0 && height <= 100) {
        overlay = window;
        visible = IsWindowVisible(window);
      }
      return true;
    }, IntPtr.Zero);
    if (overlay == IntPtr.Zero) return "FAIL overlay window not found";
    if (visible != expectedVisible) return "FAIL expectedVisible=" + expectedVisible + " actualVisible=" + visible;
    return "PASS expectedVisible=" + expectedVisible + " actualVisible=" + visible;
  }
}
'@
Add-Type -TypeDefinition $source

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$arguments = if ([System.IO.Path]::GetFileName($resolvedApp) -eq 'electron.exe') { @($projectRoot) } else { @() }
$oldDataDir = $env:FLOWTYPE_DATA_DIR

try {
  foreach ($expectedVisible in @($true, $false)) {
    $dataDir = Join-Path $env:TEMP ('FlowTypeVisibility-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $settings = @{ overlayVisible = $expectedVisible }
    $json = @{ settings = $settings; history = @() } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText((Join-Path $dataDir 'flowtype-data.json'), $json, [System.Text.UTF8Encoding]::new($false))
    $env:FLOWTYPE_DATA_DIR = $dataDir
    $app = if ($arguments.Count) {
      Start-Process -FilePath $resolvedApp -ArgumentList $arguments -PassThru
    } else {
      Start-Process -FilePath $resolvedApp -PassThru
    }
    try {
      Start-Sleep -Seconds 4
      if (!(Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { throw 'FlowType exited during visibility test' }
      $result = [FlowTypeOverlayVisibilityTest]::Run([uint32]$app.Id, $expectedVisible)
      Write-Output $result
      if ($result -notlike 'PASS*') { exit 1 }
    } finally {
      Get-Process -Id $app.Id -ErrorAction SilentlyContinue | Stop-Process -Force
      Start-Sleep -Milliseconds 500
    }
  }
} finally {
  $env:FLOWTYPE_DATA_DIR = $oldDataDir
}
