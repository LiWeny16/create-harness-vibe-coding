// Force a freshly revealed Explorer window to the foreground (Windows only).
//
// explorer.exe spawned from a background process (this server) is subject to
// the Win32 foreground lock: the new window opens behind the browser, and when
// the folder already has an Explorer window, explorer reuses it without
// raising it. This best-effort helper launches a short-lived hidden PowerShell
// that polls Shell.Application for the window showing the target folder and
// activates it via user32 (SwitchToThisWindow works from background
// processes, unlike SetForegroundWindow alone). Any failure is silent: the
// reveal itself already succeeded, this only improves focus.
//
// The target folder path travels via the WF_REVEAL_TARGET environment
// variable so no user-controlled text is embedded in the command line.
// For file reveals (/select) the Explorer window shows the parent directory,
// so the helper matches on the parent path.

import { spawn } from 'node:child_process';
import path from 'node:path';

const HELPER_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 250;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool fAltTab); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'
$target = ($env:WF_REVEAL_TARGET ?? '').TrimEnd('\\').ToLower()
if ($target) {
  $shell = New-Object -ComObject Shell.Application
  $deadline = (Get-Date).AddMilliseconds(${HELPER_TIMEOUT_MS})
  while ((Get-Date) -lt $deadline) {
    foreach ($w in @($shell.Windows())) {
      $p = $null
      try { $p = [string]$w.Document.Folder.Self.Path } catch {}
      if ($p -and $p.TrimEnd('\\').ToLower() -eq $target) {
        [W]::ShowWindow($w.hwnd, 9) | Out-Null
        [W]::SwitchToThisWindow($w.hwnd, $true)
        [W]::SetForegroundWindow($w.hwnd) | Out-Null
        exit 0
      }
    }
    Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
  }
}
`;

// Fire-and-forget: returns true when a helper was spawned (win32 only).
export function bringRevealWindowToFront({ absolutePath, isDirectory }) {
  if (process.platform !== 'win32' || !absolutePath) return false;
  // The window shows the file's parent folder for /select reveals.
  const targetFolder = isDirectory ? absolutePath : path.dirname(absolutePath);
  let child;
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', PS_SCRIPT],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, WF_REVEAL_TARGET: targetFolder },
      },
    );
  } catch {
    return false;
  }
  child.on('error', () => {});
  child.unref();
  return true;
}
