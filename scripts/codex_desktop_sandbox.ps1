<#
.SYNOPSIS
    Codex Windows Desktop Sandbox Isolation Runner
    Reverse-Engineered from OpenAI Codex codex-command-runner.exe
.DESCRIPTION
    Creates or attaches to a dedicated, isolated Win32 Desktop ("Winsta0\CodexSandboxDesk")
    and launches processes inside it. This isolates window messages, hooks, clipboard,
    and cursor interactions away from the user's default interactive desktop ("Default").
#>

param (
    [Parameter(Mandatory = $true)]
    [string]$CommandLine,

    [string]$DesktopName = "CodexSandboxDesk",

    [switch]$Wait
)

$ErrorActionPreference = "Stop"

$signature = @'
using System;
using System.Runtime.InteropServices;

public class Win32Desktop {
    public const uint DESKTOP_ALL_ACCESS = 0x01FF;
    public const uint NORMAL_PRIORITY_CLASS = 0x00000020;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateDesktop(
        string lpszDesktop,
        IntPtr lpszDevice,
        IntPtr pDevmode,
        int dwFlags,
        uint dwDesiredAccess,
        IntPtr lpsa
    );

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr OpenDesktop(
        string lpszDesktop,
        int dwFlags,
        bool fInherit,
        uint dwDesiredAccess
    );

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
'@

if (-not ([System.Management.Automation.PSTypeName]'Win32Desktop').Type) {
    Add-Type -TypeDefinition $signature -Language CSharp
}

# 1. Create or open the Codex Isolated Desktop
$hDesk = [Win32Desktop]::OpenDesktop($DesktopName, 0, $false, [Win32Desktop]::DESKTOP_ALL_ACCESS)
if ($hDesk -eq [IntPtr]::Zero) {
    $hDesk = [Win32Desktop]::CreateDesktop($DesktopName, [IntPtr]::Zero, [IntPtr]::Zero, 0, [Win32Desktop]::DESKTOP_ALL_ACCESS, [IntPtr]::Zero)
    if ($hDesk -eq [IntPtr]::Zero) {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Failed to create/open desktop '$DesktopName'. Win32 Error: $err"
    }
}

# 2. Configure STARTUPINFO targeting "Winsta0\$DesktopName"
$si = New-Object Win32Desktop+STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
$si.lpDesktop = "Winsta0\$DesktopName"

$pi = New-Object Win32Desktop+PROCESS_INFORMATION

Write-Output "[CodexSandbox] Launching in isolated desktop 'Winsta0\$DesktopName': $CommandLine"

$success = [Win32Desktop]::CreateProcess(
    $null,
    $CommandLine,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    $false,
    [Win32Desktop]::NORMAL_PRIORITY_CLASS,
    [IntPtr]::Zero,
    $null,
    [ref]$si,
    [ref]$pi
)

if (-not $success) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [Win32Desktop]::CloseDesktop($hDesk) | Out-Null
    throw "CreateProcess failed with Win32 Error: $err"
}

$pidResult = $pi.dwProcessId
Write-Output "[CodexSandbox] Process spawned successfully with PID: $pidResult"

if ($Wait) {
    [Win32Desktop]::WaitForSingleObject($pi.hProcess, 0xFFFFFFFF) | Out-Null
}

[Win32Desktop]::CloseHandle($pi.hProcess) | Out-Null
[Win32Desktop]::CloseHandle($pi.hThread) | Out-Null
[Win32Desktop]::CloseDesktop($hDesk) | Out-Null

return $pidResult
