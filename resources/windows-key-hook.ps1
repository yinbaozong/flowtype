param(
    [string]$Shortcut = 'Super+Space',
    [switch]$AllowInjected
)

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class FlowTypeHotkeyHook
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const uint LLKHF_INJECTED = 0x10;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_SHIFT = 0x10;
    private const byte VK_MENU = 0x12;
    private const byte VK_LWIN = 0x5B;
    private const byte VK_RWIN = 0x5C;
    private static readonly UIntPtr InternalInjection = new UIntPtr(0x46545950);

    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static readonly HashSet<int> Required = new HashSet<int>();
    private static readonly HashSet<int> Down = new HashSet<int>();
    private static IntPtr hookId = IntPtr.Zero;
    private static bool allowInjected;
    private static bool active;
    private static bool suppressUntilReleased;

    public static void Run(string shortcut, bool acceptInjected)
    {
        allowInjected = acceptInjected;
        foreach (string token in shortcut.Split('+'))
        {
            int key = VirtualKey(token.Trim());
            if (key == 0) throw new ArgumentException("Unsupported shortcut key: " + token);
            Required.Add(key);
        }
        if (Required.Count < 2) throw new ArgumentException("Shortcut must contain at least two keys");

        hookId = SetHook(Proc);
        if (hookId == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        Console.WriteLine("READY");
        Console.Out.Flush();
        Application.Run();
        UnhookWindowsHookEx(hookId);
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(hookId, nCode, wParam, lParam);
        int message = wParam.ToInt32();
        bool isDown = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool isUp = message == WM_KEYUP || message == WM_SYSKEYUP;
        KBDLLHOOKSTRUCT keyboard = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
        if (keyboard.extraInfo == InternalInjection)
            return CallNextHookEx(hookId, nCode, wParam, lParam);
        if (!allowInjected && (keyboard.flags & LLKHF_INJECTED) != 0)
            return CallNextHookEx(hookId, nCode, wParam, lParam);

        int key = NormalizeModifier((int)keyboard.vkCode);
        bool isRequired = Required.Contains(key);
        if (isDown) Down.Add(key);
        if (isUp) Down.Remove(key);

        bool nowActive = ContainsAllRequired();
        if (!active && nowActive)
        {
            active = true;
            suppressUntilReleased = true;
            ReleaseSystemModifiers();
            IntPtr foreground = GetForegroundWindow();
            IntPtr focus = GetFocusedWindow(foreground);
            Console.WriteLine("DOWN " + foreground.ToInt64() + " " + focus.ToInt64());
            Console.Out.Flush();
        }
        else if (active && !nowActive)
        {
            active = false;
            Console.WriteLine("UP");
            Console.Out.Flush();
        }

        bool swallow = isRequired && (active || suppressUntilReleased || nowActive);
        if (suppressUntilReleased && !AnyRequiredDown()) suppressUntilReleased = false;
        return swallow ? (IntPtr)1 : CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    private static bool ContainsAllRequired()
    {
        foreach (int key in Required) if (!Down.Contains(key)) return false;
        return true;
    }

    private static bool AnyRequiredDown()
    {
        foreach (int key in Required) if (Down.Contains(key)) return true;
        return false;
    }

    private static void ReleaseSystemModifiers()
    {
        // Modifier key-down events may already have reached Windows. Release them
        // before swallowing their physical key-up events to prevent stuck keys.
        bool hasWin = Required.Contains(VK_LWIN);
        if (hasWin) keybd_event(VK_CONTROL, 0, 0, InternalInjection);
        if (hasWin) keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, InternalInjection);
        if (Required.Contains(VK_MENU)) keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, InternalInjection);
        if (Required.Contains(VK_SHIFT)) keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, InternalInjection);
        if (Required.Contains(VK_CONTROL) || hasWin) keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, InternalInjection);
    }

    private static int NormalizeModifier(int key)
    {
        if (key == 0xA2 || key == 0xA3) return VK_CONTROL;
        if (key == 0xA4 || key == 0xA5) return VK_MENU;
        if (key == 0xA0 || key == 0xA1) return VK_SHIFT;
        if (key == VK_RWIN) return VK_LWIN;
        return key;
    }

    private static int VirtualKey(string token)
    {
        if (token.Equals("Control", StringComparison.OrdinalIgnoreCase)) return VK_CONTROL;
        if (token.Equals("Alt", StringComparison.OrdinalIgnoreCase)) return VK_MENU;
        if (token.Equals("Shift", StringComparison.OrdinalIgnoreCase)) return VK_SHIFT;
        if (token.Equals("Super", StringComparison.OrdinalIgnoreCase)) return VK_LWIN;
        if (token.Equals("Space", StringComparison.OrdinalIgnoreCase)) return 0x20;
        if (token.Equals("Left", StringComparison.OrdinalIgnoreCase)) return 0x25;
        if (token.Equals("Up", StringComparison.OrdinalIgnoreCase)) return 0x26;
        if (token.Equals("Right", StringComparison.OrdinalIgnoreCase)) return 0x27;
        if (token.Equals("Down", StringComparison.OrdinalIgnoreCase)) return 0x28;
        if (token.Equals("Backspace", StringComparison.OrdinalIgnoreCase)) return 0x08;
        if (token.Equals("Tab", StringComparison.OrdinalIgnoreCase)) return 0x09;
        if (token.Equals("Enter", StringComparison.OrdinalIgnoreCase)) return 0x0D;
        if (token.Equals("Delete", StringComparison.OrdinalIgnoreCase)) return 0x2E;
        if (token.Length == 1)
        {
            char value = Char.ToUpperInvariant(token[0]);
            if ((value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9')) return value;
        }
        int f;
        if (token.StartsWith("F", StringComparison.OrdinalIgnoreCase) && Int32.TryParse(token.Substring(1), out f) && f >= 1 && f <= 24)
            return 0x6F + f;
        var punctuation = new Dictionary<string, int> {
            { ";", 0xBA }, { "=", 0xBB }, { ",", 0xBC }, { "-", 0xBD }, { ".", 0xBE },
            { "/", 0xBF }, { "`", 0xC0 }, { "[", 0xDB }, { "\\", 0xDC }, { "]", 0xDD }, { "'", 0xDE }
        };
        int key;
        return punctuation.TryGetValue(token, out key) ? key : 0;
    }

    private static IntPtr GetFocusedWindow(IntPtr foreground)
    {
        uint processId;
        uint threadId = GetWindowThreadProcessId(foreground, out processId);
        GUITHREADINFO info = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
        return GetGUIThreadInfo(threadId, ref info) ? info.hwndFocus : IntPtr.Zero;
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(module.ModuleName), 0);
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);

    [StructLayout(LayoutKind.Sequential)] private struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct GUITHREADINFO {
        public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
    }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int left, top, right, bottom; }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms
[FlowTypeHotkeyHook]::Run($Shortcut, $AllowInjected.IsPresent)
