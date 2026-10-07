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
# Google Chrome is the exception (#44). Its branded builds ignore `--load-extension` since
# Chrome 137, so on Chrome Load unpacked is the only way in. For Chrome this script still
# manages the occlusion flag below and the shortcut, but never passes `--load-extension`.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Restart -Verify
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -InstallShortcut -InstallStartup
#   powershell -ExecutionPolicy Bypass -File scripts\start-sourcecapsule-browser.ps1 -Status

[CmdletBinding()]
param(
    # Path to the browser executable. Brave first, then Edge, then Chrome.
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
    [int]$VerifyTimeoutSeconds = 90,
    # Print the browser and the arguments this script would start it with; change nothing.
    [switch]$ShowLaunchArgs
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
        # Edge before Chrome: Edge honors --load-extension, so it needs no manual step.
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    throw 'No Brave, Edge, or Chrome executable found. Pass -BrowserPath explicitly.'
}

# Branded Google Chrome 137+ ignores --load-extension. Chromium and Chrome for Testing also
# ship a chrome.exe and still honor it, so tell them apart by product name, not file name.
function Test-IgnoresLoadExtension([string]$exePath) {
    $product = (Get-Item $exePath).VersionInfo.ProductName
    return ($product -and $product.Trim() -eq 'Google Chrome')
}

# Only the browser's main process carries the user's command line. Every renderer, GPU,
# and utility child is spawned with --type=... and must not be mistaken for it. Only the
# main process WITHOUT --user-data-dir is the owner's browser: a process with its own
# profile directory (the chrome-devtools MCP Brave, a test profile) is someone else's, and
# -Restart must never close it.
function Test-IsDefaultProfileProcess($proc) {
    return [bool]($proc.CommandLine -and $proc.CommandLine -notmatch '--user-data-dir')
}

function Get-BrowserMainProcesses([string]$exePath) {
    $exeName = Split-Path -Leaf $exePath
    $all = Get-CimInstance Win32_Process -Filter "Name='$exeName'" -ErrorAction SilentlyContinue
    if (-not $all) { return @() }
    return @($all | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' -and (Test-IsDefaultProfileProcess $_) })
}

# Every running native host, paired with the browser that spawned it (browser -> cmd.exe ->
# node.exe), or $null when no browser is left in its ancestry. A parent pid can be reused, so
# an ancestor must also be older than the process it is supposed to have spawned.
function Get-NativeHostOwners {
    $browserNames = @('brave.exe', 'chrome.exe', 'msedge.exe')
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $byId = @{}
    foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
    $hosts = @($all | Where-Object {
        ($_.Name -eq 'sourcecapsule-host.exe') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains('sourcecapsule-host'))
    })
    foreach ($h in $hosts) {
        $owner = $null
        $child = $h
        for ($depth = 0; $depth -lt 6; $depth++) {
            $parent = $byId[[int]$child.ParentProcessId]
            if (-not $parent) { break }
            if ($parent.CreationDate -and $child.CreationDate -and $parent.CreationDate -gt $child.CreationDate) { break }
            if ($browserNames -contains $parent.Name) { $owner = $parent; break }
            $child = $parent
        }
        [pscustomobject]@{ Host = $h; Browser = $owner }
    }
}

# A host whose browser is still alive, including a different browser such as Chrome or Edge
# running the extension, is not ours to stop.
function Get-OrphanedNativeHosts {
    Get-NativeHostOwners | Where-Object { -not $_.Browser } | ForEach-Object { $_.Host }
}

# Hosts spawned by any browser other than the one this script manages. Only one host owns
# the capture pipe, the first to start, so while one of these runs a capture may go to that
# browser and its flags instead. Edge's startup boost starts it windowless at sign-in, ahead
# of the Startup shortcut, so it wins the pipe every time it has the extension loaded.
function Get-ForeignNativeHosts([string]$exePath) {
    $managed = [System.IO.Path]::GetFullPath($exePath)
    Get-NativeHostOwners | Where-Object {
        $_.Browser -and -not ($_.Browser.ExecutablePath -and
            [string]::Equals([System.IO.Path]::GetFullPath($_.Browser.ExecutablePath), $managed, [System.StringComparison]::OrdinalIgnoreCase))
    }
}

# Windows occlusion tracking treats a fully covered window like a hidden tab: rendering
# suspended, rAF paused. The capture window is deliberately unfocused and therefore usually
# covered, so X fetched the conversation but never mounted it and the capsule held the root
# post alone. Measured on the same thread: without this flag the wait settles on 1 top-level
# post after 6.9s; with it, 13 posts in 1.7s and a capsule holding all 8.
$occlusionFlag = '--disable-features=CalculateNativeWinOcclusion'

function Test-HasOcclusionFlag($proc) {
    if (-not $proc.CommandLine) { return $false }
    return $proc.CommandLine -match 'CalculateNativeWinOcclusion'
}

function Test-HasExtensionFlag($proc, [string]$extensionDir) {
    if (-not $proc.CommandLine) { return $false }
    if ($proc.CommandLine -notmatch '--load-extension') { return $false }
    # Compare resolved paths, not raw strings: quoting and trailing slashes vary.
    $normalized = $extensionDir.TrimEnd('\', '/')
    # -like reads [ ] ? * in a path as wildcards, so a repo under "...\[work]" never matched itself.
    $pattern = '*' + [System.Management.Automation.WildcardPattern]::Escape($normalized) + '*'
    return $proc.CommandLine.Replace('/', '\') -like $pattern
}

# What "started correctly" means depends on the browser. Where --load-extension works, it
# must be on the command line. On Chrome the extension comes from Load unpacked, which no
# command line shows, so the occlusion flag is the only thing this script can check.
function Test-HasLaunchFlags($proc) {
    if ($loadUnpacked) { return Test-HasOcclusionFlag $proc }
    return Test-HasExtensionFlag $proc $extensionFull
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

function New-BrowserShortcut([string]$path, [string]$exePath) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exePath
    $link.Arguments = $launchArgs
    $link.WorkingDirectory = Split-Path -Parent $exePath
    $link.IconLocation = "$exePath,0"
    $link.Description = 'Browser with the SourceCapsule extension loaded (unattended capture bridge)'
    $link.Save()
    Write-Host "Installed $path"
}

$browser = Resolve-BrowserPath
$extensionFull = $ExtensionDir
# Resolve-Path keeps a trailing backslash, and a backslash before the closing quote below is
# read by Windows as an escaped quote, which merges every following flag into the path.
if (Test-Path $extensionFull) { $extensionFull = (Resolve-Path $extensionFull).Path.TrimEnd('\', '/') }
$loadUnpacked = Test-IgnoresLoadExtension $browser
$launchArgs = "$occlusionFlag --restore-last-session"
if (-not $loadUnpacked) { $launchArgs = "--load-extension=`"$extensionFull`" $launchArgs" }
$loadUnpackedHelp = "Google Chrome ignores --load-extension, so load SourceCapsule once by hand: open chrome://extensions, turn on Developer mode, choose Load unpacked, and select $extensionFull. It stays loaded across restarts."

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

if ($loadUnpacked) { Write-Host $loadUnpackedHelp }

if ($ShowLaunchArgs) {
    Write-Host "Browser: $browser"
    Write-Host "Arguments: $launchArgs"
    exit 0
}

# @() around the call as well: PowerShell unrolls a single-element return, and a scalar
# has no .Count in 5.1, which silently prints a blank instead of "1".
$running = @(Get-BrowserMainProcesses $browser)
$withFlag = @($running | Where-Object { Test-HasLaunchFlags $_ })
$withoutFlag = @($running | Where-Object { -not (Test-HasLaunchFlags $_) })

if ($Status) {
    Write-Host "Browser:   $browser"
    Write-Host "Extension: $extensionFull"
    Write-Host "Running main processes: $($running.Count)"
    Write-Host "  with the launch flags:    $($withFlag.Count)"
    Write-Host "  without the launch flags: $($withoutFlag.Count)"
    $occluded = @($withFlag | Where-Object { -not (Test-HasOcclusionFlag $_) })
    foreach ($entry in (Get-ShortcutTargets).GetEnumerator()) {
        $state = 'missing'
        if (Test-Path $entry.Value) { $state = 'installed' }
        Write-Host ("  shortcut {0,-9} {1}" -f $entry.Key, $state)
    }
    $foreign = @(Get-ForeignNativeHosts $browser)
    if ($foreign.Count -gt 0) {
        $collapsing = $false
        foreach ($f in $foreign) {
            $occlusion = 'without'
            if (Test-HasOcclusionFlag $f.Browser) { $occlusion = 'with' } else { $collapsing = $true }
            Write-Host ("  host pid {0} belongs to {1} pid {2} ({3} {4})" -f $f.Host.ProcessId, $f.Browser.ExecutablePath, $f.Browser.ProcessId, $occlusion, $occlusionFlag)
        }
        Write-Warning ('SourceCapsule is also loaded in another browser. Only one host owns the capture pipe, so captures may run there instead of in ' + (Split-Path -Leaf $browser) + '. Remove the extension from that browser, or turn off its background start (Edge: Settings > System > Startup boost).')
        if ($collapsing) {
            Write-Warning ('That browser is running without ' + $occlusionFlag + ', so a thread captured there comes back as its root post alone.')
            exit 3
        }
    }
    if ($withFlag.Count -gt 0) {
        if ($occluded.Count -gt 0) {
            Write-Warning ('The browser is running without ' + $occlusionFlag + '. Captures will still publish, but a thread will come back as its root post alone. Repair with -Restart -Verify, and reinstall the shortcut with -InstallShortcut.')
            exit 3
        }
        Write-Host 'Bridge should be available. Confirm with: node scripts\sourcecapsule-capture.mjs --ping'
        exit 0
    }
    if ($withoutFlag.Count -gt 0) {
        if ($loadUnpacked) {
            # Same meaning as the exit 3 above. Exit 2 is reserved for "no extension".
            Write-Warning ('Chrome is running without ' + $occlusionFlag + '. Captures will still publish, but a thread will come back as its root post alone. Repair with -Restart -Verify.')
            exit 3
        }
        Write-Warning 'The browser is running WITHOUT the extension. Unattended capture will fail.'
        exit 2
    }
    Write-Host 'The browser is not running.'
    exit 1
}

if ($InstallShortcut -or $InstallStartup) {
    $targets = Get-ShortcutTargets
    if ($InstallShortcut) {
        New-BrowserShortcut $targets.Desktop $browser
        New-BrowserShortcut $targets.StartMenu $browser
    }
    if ($InstallStartup) {
        New-BrowserShortcut $targets.Startup $browser
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
            Write-Warning 'The browser is already running WITHOUT the SourceCapsule launch flags.'
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
        # Child processes outlive the main window briefly and would swallow the flag. Wait
        # only on this profile's processes: another profile's browser may stay open.
        $exeName = Split-Path -Leaf $browser
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            $left = @(Get-CimInstance Win32_Process -Filter "Name='$exeName'" -ErrorAction SilentlyContinue | Where-Object { Test-IsDefaultProfileProcess $_ })
            if ($left.Count -eq 0) { break }
            Start-Sleep -Milliseconds 500
        }
        Start-Sleep -Seconds 2
        # A host whose browser is gone still owns \\.\pipe\sourcecapsule-capture, and the new
        # browser's host would lose the race for it. Hosts of browsers that are still running
        # (another profile, Chrome, Edge) are left alone; a host that lost the race retries.
        foreach ($orphan in @(Get-OrphanedNativeHosts)) {
            Write-Host "Stopping orphaned native host (pid $($orphan.ProcessId))"
            Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Starting $browser $launchArgs"
    Start-Process -FilePath $browser -ArgumentList $launchArgs
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
if ($loadUnpacked) { Write-Warning $loadUnpackedHelp }
else { Write-Warning 'Open the browser''s extensions page and confirm SourceCapsule is listed and enabled.' }
exit 1
