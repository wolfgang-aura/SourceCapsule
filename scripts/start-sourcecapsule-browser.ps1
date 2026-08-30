# Starts the browser with the SourceCapsule extension loaded, so the native messaging
# bridge (and therefore unattended capture) is actually available.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# `--load-extension` installs the extension at Chromium's COMMAND_LINE location. Brave
# records it in the profile (Secure Preferences shows `"location": 8`) but deliberately
# does NOT load it again on a start that lacks the flag. So a normal Brave restart has no
# SourceCapsule extension at all - no service worker, no native port - and the CLI
# reports the host as unreachable. The worker is not asleep; it does not exist.
#
# Two ways to make that durable. This script is the scriptable one:
#   * Always start Brave through this script (or the shortcut it installs).
#   * Or, once, load `dist\sourcecapsule-extension` via Load unpacked on brave://extensions,
#     which records location 4 and survives restarts on its own. That is a manual UI step
#     and cannot coexist with the command-line copy: same `key`, same extension ID.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Restart -Verify
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -InstallShortcut -InstallStartup
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Status

[CmdletBinding()]
param(
    # Path to the browser executable. Brave first, then Chrome, then Edge.
    [string]$BrowserPath,
    # Unpacked extension directory. Defaults to <repo>\dist\sourcecapsule-extension.
    [string]$ExtensionDir,
    # Close a browser that is running WITHOUT the flag, then relaunch it with it.
    [switch]$Restart,
    # After launching, poll the CLI's --ping until the bridge answers.
    [switch]$Verify,
    # Create "Brave with SourceCapsule" on the Desktop and in the Start Menu.
    [switch]$InstallShortcut,
    # Also drop that shortcut in the per-user Startup folder.
    [switch]$InstallStartup,
    # Remove the shortcuts this script installed.
    [switch]$UninstallShortcut,
    # Report what is running and whether the flag is present; change nothing.
    [switch]$Status,
    # Seconds to wait for -Verify to see a healthy bridge.
    [int]$VerifyTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$shortcutName = 'Brave with SourceCapsule.lnk'

if (-not $ExtensionDir) {
    $ExtensionDir = Join-Path $repoRoot 'dist\sourcecapsule-extension'
}

function Resolve-BrowserPath {
    if ($BrowserPath) {
        if (-not (Test-Path $BrowserPath)) { throw "Browser not found: $BrowserPath" }
        return (Resolve-Path $BrowserPath).Path
    }
    $candidates = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    throw 'No Brave, Chrome, or Edge executable found. Pass -BrowserPath explicitly.'
}

# Only the browser's main process carries the user's command line. Every renderer, GPU,
# and utility child is spawned with --type=... and must not be mistaken for it.
function Get-BrowserMainProcesses([string]$exePath) {
    $exeName = Split-Path -Leaf $exePath
    $all = Get-CimInstance Win32_Process -Filter "Name='$exeName'" -ErrorAction SilentlyContinue
    if (-not $all) { return @() }
    return @($all | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' })
}

function Test-HasExtensionFlag($proc, [string]$extensionDir) {
    if (-not $proc.CommandLine) { return $false }
    if ($proc.CommandLine -notmatch '--load-extension') { return $false }
    # Compare resolved paths, not raw strings: quoting and trailing slashes vary.
    $normalized = $extensionDir.TrimEnd('\', '/')
    return $proc.CommandLine.Replace('/', '\') -like "*$normalized*"
}

function Get-ShortcutTargets {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    return [ordered]@{
        Desktop   = Join-Path $desktop $shortcutName
        StartMenu = Join-Path $startMenu $shortcutName
        Startup   = Join-Path $startup $shortcutName
    }
}

function New-BrowserShortcut([string]$path, [string]$exePath, [string]$extensionDir) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exePath
    $link.Arguments = "--load-extension=`"$extensionDir`" --restore-last-session"
    $link.WorkingDirectory = Split-Path -Parent $exePath
    $link.IconLocation = "$exePath,0"
    $link.Description = 'Brave with the SourceCapsule extension loaded (unattended capture bridge)'
    $link.Save()
    Write-Host "Installed $path"
}

$browser = Resolve-BrowserPath
$extensionFull = $ExtensionDir
if (Test-Path $extensionFull) { $extensionFull = (Resolve-Path $extensionFull).Path }

if ($UninstallShortcut) {
    foreach ($entry in (Get-ShortcutTargets).GetEnumerator()) {
        if (Test-Path $entry.Value) {
            Remove-Item $entry.Value -Force
            Write-Host "Removed $($entry.Value)"
        }
    }
    Write-Host 'SourceCapsule browser shortcuts removed.'
    exit 0
}

if (-not (Test-Path (Join-Path $extensionFull 'manifest.json'))) {
    throw "No unpacked extension at $extensionFull. Build it first: npm run build:extension"
}

# @() around the call as well: PowerShell unrolls a single-element return, and a scalar
# has no .Count in 5.1, which silently prints a blank instead of "1".
$running = @(Get-BrowserMainProcesses $browser)
$withFlag = @($running | Where-Object { Test-HasExtensionFlag $_ $extensionFull })
$withoutFlag = @($running | Where-Object { -not (Test-HasExtensionFlag $_ $extensionFull) })

if ($Status) {
    Write-Host "Browser:   $browser"
    Write-Host "Extension: $extensionFull"
    Write-Host "Running main processes: $($running.Count)"
    Write-Host "  with the extension flag:    $($withFlag.Count)"
    Write-Host "  without the extension flag: $($withoutFlag.Count)"
    foreach ($entry in (Get-ShortcutTargets).GetEnumerator()) {
        $state = 'missing'
        if (Test-Path $entry.Value) { $state = 'installed' }
        Write-Host ("  shortcut {0,-9} {1}" -f $entry.Key, $state)
    }
    if ($withFlag.Count -gt 0) {
        Write-Host 'Bridge should be available. Confirm with: node scripts\sourcecapsule-capture.mjs --ping'
        exit 0
    }
    if ($withoutFlag.Count -gt 0) {
        Write-Warning 'The browser is running WITHOUT the extension. Unattended capture will fail.'
        exit 2
    }
    Write-Host 'The browser is not running.'
    exit 1
}

if ($InstallShortcut -or $InstallStartup) {
    $targets = Get-ShortcutTargets
    if ($InstallShortcut) {
        New-BrowserShortcut $targets.Desktop $browser $extensionFull
        New-BrowserShortcut $targets.StartMenu $browser $extensionFull
    }
    if ($InstallStartup) {
        New-BrowserShortcut $targets.Startup $browser $extensionFull
    }
    Write-Host ''
    Write-Host 'Start the browser from this shortcut and the capture bridge is always present.'
    Write-Host 'Starting it any other way silently drops the extension.'
    if (-not ($Restart -or $Verify)) { exit 0 }
}

if ($withFlag.Count -gt 0 -and -not $Restart) {
    Write-Host "Already running with the extension loaded (pid $($withFlag[0].ProcessId))."
}
else {
    # -Restart means restart, whatever the flag state. Otherwise a second Start-Process
    # would merely hand the URL to the process already running and drop the flag.
    if ($running.Count -gt 0) {
        if (-not $Restart) {
            Write-Warning 'The browser is already running WITHOUT the SourceCapsule extension.'
            Write-Warning 'Launching it again would only open a tab in that process; the flag would be ignored.'
            Write-Warning 'Re-run with -Restart to close it and start it with the extension.'
            exit 2
        }
        foreach ($proc in $running) {
            Write-Host "Closing browser pid $($proc.ProcessId)..."
            $handle = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
            if ($handle) {
                # Graceful first: the session (and --restore-last-session) survives it.
                $null = $handle.CloseMainWindow()
                if (-not $handle.WaitForExit(20000)) {
                    Write-Warning "pid $($proc.ProcessId) did not close in 20s; forcing."
                    $handle | Stop-Process -Force
                }
            }
        }
        # Child processes outlive the main window briefly and would swallow the flag.
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($browser)) -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
        }
        Start-Sleep -Seconds 2
        # Every browser is now closed, so any surviving host is an orphan by definition.
        # It still owns \\.\pipe\sourcecapsule-capture, and the new browser's host would
        # lose the race for it, leaving the CLI talking to a host with no extension.
        Get-Process -Name 'sourcecapsule-host' -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "Stopping orphaned native host (pid $($_.Id))"
            $_ | Stop-Process -Force
        }
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*sourcecapsule-host*' } | ForEach-Object {
                Write-Host "Stopping orphaned host process (pid $($_.ProcessId))"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }
    Write-Host "Starting $browser with $extensionFull"
    Start-Process -FilePath $browser -ArgumentList @(
        "--load-extension=$extensionFull",
        '--restore-last-session'
    )
}

if (-not $Verify) {
    Write-Host 'Verify the bridge with: node scripts\sourcecapsule-capture.mjs --ping'
    exit 0
}

# A launcher that cannot fail silently: poll the same bridge the CLI uses.
$cli = Join-Path $repoRoot 'scripts\sourcecapsule-capture.mjs'
$deadline = (Get-Date).AddSeconds($VerifyTimeoutSeconds)
$attempt = 0
while ((Get-Date) -lt $deadline) {
    $attempt++
    Start-Sleep -Seconds 5
    Write-Host "Bridge check $attempt..."
    # Do NOT redirect the CLI's stderr here. In PowerShell 5.1, `2>&1` on a native exe
    # wraps each stderr line in an ErrorRecord, and with $ErrorActionPreference = 'Stop'
    # that aborts this loop on the CLI's own progress output. Exit code is the signal.
    $output = & node $cli --ping
    if ($LASTEXITCODE -eq 0) {
        Write-Host ''
        Write-Host 'Bridge is live:'
        Write-Host ($output -join "`n")
        exit 0
    }
}
Write-Warning "The bridge did not answer within $VerifyTimeoutSeconds seconds."
Write-Warning 'Open brave://extensions and confirm SourceCapsule is listed and enabled.'
exit 1
