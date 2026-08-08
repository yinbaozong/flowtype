param([string]$AppPath = "$PSScriptRoot\..\node_modules\electron\dist\electron.exe")

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OverlayDragTest {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  struct RECT { public int l,t,r,b; }
  public static string Run(uint pid) {
    IntPtr target = IntPtr.Zero; RECT start = new RECT(); int smallest = 99999;
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h,out p); RECT r; GetWindowRect(h,out r);
      int w=r.r-r.l, height=r.b-r.t;
      if (p == pid && w > 0 && height > 0 && w < smallest) { target=h; start=r; smallest=w; } return true; }, IntPtr.Zero);
    if (target == IntPtr.Zero) return "FAIL no overlay";
    List<int> widths=new List<int>();
    for(int round=0;round<6;round++) {
      RECT before; GetWindowRect(target,out before);
      int sx=(before.l+before.r)/2, sy=(before.t+before.b)/2;
      int direction=round % 2 == 0 ? 1 : -1;
      SetCursorPos(sx,sy); mouse_event(2,0,0,0,UIntPtr.Zero);
      for(int i=1;i<=14;i++){
        SetCursorPos(sx+direction*i*7,sy+i*2);
        System.Threading.Thread.Sleep(30);
        RECT during; GetWindowRect(target,out during); widths.Add(during.r-during.l);
      }
      mouse_event(4,0,0,0,UIntPtr.Zero);
      System.Threading.Thread.Sleep(100);
      RECT after; GetWindowRect(target,out after);
      int moved=Math.Abs(after.l-before.l)+Math.Abs(after.t-before.t);
      if(moved < 20) return "FAIL drag round="+round+" moved="+moved;
    }
    foreach(int w in widths) if(w != smallest) return "FAIL baseline="+smallest+" widths="+String.Join(",",widths);
    return "PASS rounds=6 baseline="+smallest+" finalWidth="+widths[widths.Count-1];
  }
}
'@
Add-Type -TypeDefinition $source

$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$oldDataDir = $env:FLOWTYPE_DATA_DIR
$env:FLOWTYPE_DATA_DIR = Join-Path $env:TEMP ('FlowTypeDrag-' + [guid]::NewGuid().ToString('N'))
$arguments = if ([System.IO.Path]::GetFileName($resolvedApp) -eq 'electron.exe') { @($projectRoot) } else { @() }
$app = if ($arguments.Count) {
  Start-Process -FilePath $resolvedApp -ArgumentList $arguments -PassThru
} else {
  Start-Process -FilePath $resolvedApp -PassThru
}
try {
  Start-Sleep -Seconds 5
  if (!(Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { throw 'FlowType exited during drag test' }
  $result = [OverlayDragTest]::Run([uint32]$app.Id)
  Write-Output $result
  if ($result -notlike 'PASS*') { exit 1 }
} finally {
  Get-Process -Id $app.Id -ErrorAction SilentlyContinue | Stop-Process -Force
  $env:FLOWTYPE_DATA_DIR = $oldDataDir
}
