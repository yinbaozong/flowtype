param([switch]$AllowInjected)

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class FlowTypeShortcutCapture
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const uint LLKHF_INJECTED = 0x10;
    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static readonly HashSet<int> Down = new HashSet<int>();
    private static readonly HashSet<int> Seen = new HashSet<int>();
    private static IntPtr hookId = IntPtr.Zero;
    private static bool allowInjected;
    private static bool finished;
    private static Timer timeout;

    public static void Run(bool acceptInjected)
    {
        allowInjected = acceptInjected;
        hookId = SetHook(Proc);
        timeout = new Timer { Interval = 12000 };
        timeout.Tick += delegate { Finish("CANCEL"); };
        timeout.Start();
        Application.Run();
        timeout.Dispose();
        UnhookWindowsHookEx(hookId);
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0 || finished) return CallNextHookEx(hookId, nCode, wParam, lParam);
        int message = wParam.ToInt32();
        bool isDown = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool isUp = message == WM_KEYUP || message == WM_SYSKEYUP;
        KBDLLHOOKSTRUCT keyboard = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
        if (!allowInjected && (keyboard.flags & LLKHF_INJECTED) != 0)
            return CallNextHookEx(hookId, nCode, wParam, lParam);

        int key = (int)keyboard.vkCode;
        if (isDown) { Down.Add(key); Seen.Add(key); }
        if (isUp) Down.Remove(key);
        if (isUp && Down.Count == 0 && Seen.Count > 0) CompleteShortcut();
        return (IntPtr)1;
    }

    private static void CompleteShortcut()
    {
        bool control = HasAny(0x11, 0xA2, 0xA3);
        bool alt = HasAny(0x12, 0xA4, 0xA5);
        bool shift = HasAny(0x10, 0xA0, 0xA1);
        bool super = HasAny(0x5B, 0x5C);
        int trigger = 0;
        foreach (int key in Seen) if (!IsModifier(key)) { trigger = key; break; }

        if (!(control || alt || shift || super) || (trigger == 0 && !(alt && super))) {
            Finish("INVALID");
            return;
        }

        var parts = new List<string>();
        if (control) parts.Add("Control");
        if (alt) parts.Add("Alt");
        if (shift) parts.Add("Shift");
        if (super) parts.Add("Super");
        if (trigger != 0) {
            string triggerName = KeyName(trigger);
            if (triggerName == "") { Finish("INVALID"); return; }
            parts.Add(triggerName);
        }
        Finish("SHORTCUT " + String.Join("+", parts));
    }

    private static bool HasAny(params int[] keys)
    {
        foreach (int key in keys) if (Seen.Contains(key)) return true;
        return false;
    }

    private static bool IsModifier(int key)
    {
        return key == 0x11 || key == 0xA2 || key == 0xA3 || key == 0x12 || key == 0xA4 || key == 0xA5 ||
               key == 0x10 || key == 0xA0 || key == 0xA1 || key == 0x5B || key == 0x5C;
    }

    private static string KeyName(int key)
    {
        if (key >= 0x41 && key <= 0x5A) return ((char)key).ToString();
        if (key >= 0x30 && key <= 0x39) return ((char)key).ToString();
        if (key >= 0x70 && key <= 0x87) return "F" + (key - 0x6F);
        switch (key) {
            case 0x20: return "Space";
            case 0x25: return "Left";
            case 0x26: return "Up";
            case 0x27: return "Right";
            case 0x28: return "Down";
            case 0x08: return "Backspace";
            case 0x09: return "Tab";
            case 0x0D: return "Enter";
            case 0x2E: return "Delete";
            case 0xBA: return ";";
            case 0xBB: return "=";
            case 0xBC: return ",";
            case 0xBD: return "-";
            case 0xBE: return ".";
            case 0xBF: return "/";
            case 0xC0: return "`";
            case 0xDB: return "[";
            case 0xDC: return "\\";
            case 0xDD: return "]";
            case 0xDE: return "'";
            default: return "";
        }
    }

    private static void Finish(string result)
    {
        if (finished) return;
        finished = true;
        Console.WriteLine(result);
        Console.Out.Flush();
        Application.ExitThread();
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(module.ModuleName), 0);
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);
    [StructLayout(LayoutKind.Sequential)] private struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr extraInfo; }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms
[FlowTypeShortcutCapture]::Run($AllowInjected.IsPresent)
