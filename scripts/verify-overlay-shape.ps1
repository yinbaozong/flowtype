param([string]$AppPath = "$PSScriptRoot\..\node_modules\electron\dist\electron.exe")

$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class FlowTypeOverlayShapeTest {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region, out RECT rect);
  [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region, int x, int y);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
  struct RECT { public int left, top, right, bottom; }

  public static string Run(uint targetProcessId) {
    IntPtr overlay = IntPtr.Zero;
    RECT overlayRect = new RECT();
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      RECT rect;
      GetWindowRect(window, out rect);
      int width = rect.right - rect.left;
      int height = rect.bottom - rect.top;
      if (processId == targetProcessId && IsWindowVisible(window) && width >= 44 && width <= 280 && height <= 100) {
        overlay = window;
        overlayRect = rect;
      }
      return true;
    }, IntPtr.Zero);
    if (overlay == IntPtr.Zero) return "FAIL overlay window not found";

    int windowWidth = overlayRect.right - overlayRect.left;
    int windowHeight = overlayRect.bottom - overlayRect.top;
    IntPtr region = CreateRectRgn(0, 0, 0, 0);
    try {
      int regionType = GetWindowRgn(overlay, region);
      RECT box;
      GetRgnBox(region, out box);
      bool center = PtInRegion(region, windowWidth / 2, windowHeight / 2);
      bool top = PtInRegion(region, windowWidth / 2, 2);
      bool bottom = PtInRegion(region, windowWidth / 2, windowHeight - 3);
      if (regionType == 0 || !center || top || bottom)
        return "FAIL regionType=" + regionType + " center=" + center + " top=" + top + " bottom=" + bottom;
      return "PASS window=" + windowWidth + "x" + windowHeight +
        " region=" + (box.right - box.left) + "x" + (box.bottom - box.top) +
        " outside pixels clipped";
    } finally {
      DeleteObject(region);
    }
  }
}
'@
Add-Type -TypeDefinition $source

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Get-Process FlowType -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$oldDataDir = $env:FLOWTYPE_DATA_DIR
$env:FLOWTYPE_DATA_DIR = Join-Path $env:TEMP ('FlowTypeShape-' + [guid]::NewGuid().ToString('N'))
$arguments = if ([System.IO.Path]::GetFileName($resolvedApp) -eq 'electron.exe') { @($projectRoot) } else { @() }
$app = if ($arguments.Count) {
  Start-Process -FilePath $resolvedApp -ArgumentList $arguments -PassThru
} else {
  Start-Process -FilePath $resolvedApp -PassThru
}
try {
  Start-Sleep -Seconds 5
  if (!(Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { throw 'Packaged FlowType exited during shape test' }
  $result = [FlowTypeOverlayShapeTest]::Run([uint32]$app.Id)
  Write-Output $result
  if ($result -notlike 'PASS*') { exit 1 }
} finally {
  Get-Process -Id $app.Id -ErrorAction SilentlyContinue | Stop-Process -Force
  $env:FLOWTYPE_DATA_DIR = $oldDataDir
}
