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
    int sx=(start.l+start.r)/2, sy=(start.t+start.b)/2;
    SetCursorPos(sx,sy); mouse_event(2,0,0,0,UIntPtr.Zero);
    List<int> widths=new List<int>();
    for(int i=1;i<=20;i++){ SetCursorPos(sx+i*8,sy-i*2); System.Threading.Thread.Sleep(35); RECT r; GetWindowRect(target,out r); widths.Add(r.r-r.l); }
    mouse_event(4,0,0,0,UIntPtr.Zero);
    foreach(int w in widths) if(w != smallest) return "FAIL baseline="+smallest+" widths="+String.Join(",",widths);
    return "PASS baseline="+smallest+" widths="+String.Join(",",widths);
  }
}
'@
Add-Type -TypeDefinition $source
$main = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'electron.exe' -and
  $_.CommandLine -notmatch '--type='
} | Select-Object -First 1
if (!$main) { throw 'FlowType main process not found' }
$result = [OverlayDragTest]::Run([uint32]$main.ProcessId)
Write-Output $result
if ($result -notlike 'PASS*') { exit 1 }
