$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Runtime.InteropServices;
public static class FlowTypeHotkeyTestInput {
  const uint KEYEVENTF_KEYUP = 0x0002;
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  public static void Down(byte key) { keybd_event(key, 0, 0, UIntPtr.Zero); }
  public static void Up(byte key) { keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); }
  public static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
}
'@
Add-Type -TypeDefinition $source

$keys = @{
  Control = [byte]0x11
  Alt = [byte]0x12
  Shift = [byte]0x10
  Super = [byte]0x5B
  Space = [byte]0x20
  D = [byte]0x44
}

function Test-Shortcut([string]$shortcut) {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'powershell.exe'
  $start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSScriptRoot\..\resources\windows-key-hook.ps1`" -Shortcut `"$shortcut`" -AllowInjected"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($start)
  try {
    $ready = $process.StandardOutput.ReadLine()
    if ($ready -ne 'READY') { throw "listener did not become ready: $ready $($process.StandardError.ReadToEnd())" }
    $parts = $shortcut.Split('+')
    foreach ($part in $parts) { [FlowTypeHotkeyTestInput]::Down($keys[$part]) }
    Start-Sleep -Milliseconds 120
    for ($index = $parts.Length - 1; $index -ge 0; $index--) { [FlowTypeHotkeyTestInput]::Up($keys[$parts[$index]]) }
    $down = $process.StandardOutput.ReadLine()
    $up = $process.StandardOutput.ReadLine()
    if ($down -notlike 'DOWN *' -or $up -ne 'UP') { throw "unexpected events: '$down' '$up'" }
    Start-Sleep -Milliseconds 100
    foreach ($modifier in @('Control', 'Alt', 'Shift', 'Super')) {
      if ([FlowTypeHotkeyTestInput]::IsDown($keys[$modifier])) { throw "$modifier remained pressed after $shortcut" }
    }
    foreach ($letter in @([byte]0x41, [byte]0x42, [byte]0x43, [byte]0x44)) {
      [FlowTypeHotkeyTestInput]::Down($letter); [FlowTypeHotkeyTestInput]::Up($letter)
    }
    Write-Output "PASS $shortcut - DOWN/UP received and modifiers released"
  } finally {
    if (!$process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}

function Test-Capture {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'powershell.exe'
  $start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSScriptRoot\..\resources\shortcut-capture.ps1`" -AllowInjected"
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($start)
  try {
    Start-Sleep -Milliseconds 500
    foreach ($key in @($keys.Control, $keys.Alt, $keys.D)) { [FlowTypeHotkeyTestInput]::Down($key) }
    foreach ($key in @($keys.D, $keys.Alt, $keys.Control)) { [FlowTypeHotkeyTestInput]::Up($key) }
    $result = $process.StandardOutput.ReadLine()
    if ($result -ne 'SHORTCUT Control+Alt+D') { throw "unexpected capture result: '$result' $($process.StandardError.ReadToEnd())" }
    Write-Output 'PASS capture - Control+Alt+D recorded by native hook'
  } finally {
    if (!$process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}

Test-Shortcut 'Alt+Super'
Test-Shortcut 'Super+Space'
Test-Shortcut 'Control+Alt+D'
Test-Capture
