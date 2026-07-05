param(
    [ValidateSet('WinSpace', 'AltWin')]
    [string]$Mode = 'WinSpace',
    [switch]$AllowInjected
)

$source = @'
using System;
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
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_SPACE = 0x20;
    private const int VK_MENU = 0x12;
    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;
    private const byte VK_CONTROL = 0x11;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint LLKHF_INJECTED = 0x00000010;
    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static IntPtr HookId = IntPtr.Zero;
    private static bool winDown;
    private static bool spaceDown;
    private static bool altDown;
    private static bool active;
    private static bool suppressWinUp;
    private static bool altWinMode;
    private static bool allowInjected;

    public static void Run(bool useAltWin, bool acceptInjected)
    {
        altWinMode = useAltWin;
        allowInjected = acceptInjected;
        Console.Out.Flush();
        HookId = SetHook(Proc);
        Application.Run();
        UnhookWindowsHookEx(HookId);
    }

    private static IntPtr GetFocusedWindow(IntPtr foreground)
    {
        uint processId;
        uint threadId = GetWindowThreadProcessId(foreground, out processId);
        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(info);
        return GetGUIThreadInfo(threadId, ref info) ? info.hwndFocus : IntPtr.Zero;
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(module.ModuleName), 0);
        }
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int message = wParam.ToInt32();
            bool isDown = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            bool isUp = message == WM_KEYUP || message == WM_SYSKEYUP;
            KBDLLHOOKSTRUCT keyboard = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            int vk = (int)keyboard.vkCode;
            if (!allowInjected && (keyboard.flags & LLKHF_INJECTED) != 0)
            {
                return CallNextHookEx(HookId, nCode, wParam, lParam);
            }
            bool wasActive = active;

            if (vk == VK_LWIN || vk == VK_RWIN)
            {
                if (isDown) winDown = true;
                if (isUp) winDown = false;
            }
            else if (vk == VK_SPACE)
            {
                if (isDown) spaceDown = true;
                if (isUp) spaceDown = false;
            }
            else if (vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU)
            {
                if (isDown) altDown = true;
                if (isUp) altDown = false;
            }

            bool nowActive = winDown && (altWinMode ? altDown : spaceDown);
            if (!active && nowActive)
            {
                active = true;
                suppressWinUp = true;
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

            bool isWin = vk == VK_LWIN || vk == VK_RWIN;
            bool swallowWinUp = isWin && isUp && suppressWinUp;
            if (swallowWinUp)
            {
                suppressWinUp = false;
                ReleaseWinWithoutOpeningStart((byte)vk);
            }

            bool isAlt = vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU;
            bool triggerKey = altWinMode ? (isWin || isAlt) : vk == VK_SPACE;
            bool swallow = swallowWinUp || (triggerKey && (winDown || wasActive || nowActive));
            if (swallow) return (IntPtr)1;
        }

        return CallNextHookEx(HookId, nCode, wParam, lParam);
    }

    private static void ReleaseWinWithoutOpeningStart(byte winKey)
    {
        // Release Win while Ctrl is held so Windows resets the modifier state
        // without treating it as a standalone Win press that opens Start/Search.
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(winKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public int cbSize;
        public int flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms
[FlowTypeHotkeyHook]::Run($Mode -eq 'AltWin', $AllowInjected.IsPresent)
