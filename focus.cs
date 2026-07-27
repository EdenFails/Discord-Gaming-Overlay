using System;
using System.Runtime.InteropServices;

namespace FocusApp
{
    class Program
    {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        static void Main(string[] args)
        {
            long targetHwndLong;
            if (args.Length > 0 && long.TryParse(args[0], out targetHwndLong))
            {
                IntPtr targetHwnd = new IntPtr(targetHwndLong);
                IntPtr currentHwnd = GetForegroundWindow();
                
                if (currentHwnd != targetHwnd)
                {
                    keybd_event(0x12, 0, 0, 0);
                    SetForegroundWindow(targetHwnd);
                    keybd_event(0x12, 0, 2, 0);
                }
                
                Console.WriteLine(currentHwnd.ToInt64());
            }
        }
    }
}
