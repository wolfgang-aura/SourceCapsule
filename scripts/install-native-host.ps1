# Registers the SourceCapsule native messaging host for the CURRENT USER only.
# No administrator rights are needed: everything lands under HKCU.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1 -Uninstall

[CmdletBinding()]
param(
    [string]$ExtensionId = 'gaclgcfljpjojddiikddejenlnjaggie',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$startedAt = (Get-Date).AddSeconds(-2)

$hostName = 'com.wolfgang_aura.sourcecapsule'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot 'native-host'
$sourceScript = Join-Path $sourceDir 'sourcecapsule-host.mjs'

# The host is INSTALLED outside the repo, under LOCALAPPDATA. The browser resolves the
# manifest path at connect time, so a repo that moves, gets cleaned, or sits in a synced
# folder must not be able to break an existing registration.
$hostDir = Join-Path $env:LOCALAPPDATA 'SourceCapsule\native-host'
$hostScript = Join-Path $hostDir 'sourcecapsule-host.mjs'
$hostCmd = Join-Path $hostDir 'sourcecapsule-host.cmd'
$hostExe = Join-Path $hostDir 'sourcecapsule-host.exe'
$manifestPath = Join-Path $hostDir "$hostName.json"

# Chrome, Edge, and Brave all read the same per-user layout under their own key.
$registryRoots = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
)

if ($Uninstall) {
    foreach ($root in $registryRoots) {
        $key = Join-Path $root $hostName
        if (Test-Path $key) {
            Remove-Item -Path $key -Recurse -Force
            Write-Host "Removed $key"
        }
    }
    foreach ($stale in @($hostExe, $hostCmd, (Join-Path $hostDir 'node-path.txt'))) {
        if (Test-Path $stale) { Remove-Item $stale -Force; Write-Host "Removed $stale" }
    }
    if (Test-Path $manifestPath) {
        Remove-Item -Path $manifestPath -Force
        Write-Host "Removed $manifestPath"
    }
    Write-Host 'SourceCapsule native host unregistered.'
    exit 0
}

if (-not (Test-Path $sourceScript)) {
    throw "Host script not found: $sourceScript"
}
if (-not (Test-Path $hostDir)) {
    New-Item -ItemType Directory -Path $hostDir -Force | Out-Null
}
Copy-Item -Path $sourceScript -Destination $hostScript -Force
Write-Host "Installed $hostScript"

$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($null -eq $node) {
    throw 'node was not found on PATH. Install Node 18+ and re-run.'
}
$nodeExe = $node.Source
Write-Host "Node: $nodeExe"

# The registered host is a two-line .cmd that runs the signed node.exe. Smart App Control
# blocks unsigned executables and has no per-file allowlist, so the compiled launcher this
# script used to build (native-host/launcher.cs) never ran on a machine with it on (#8).
# The .cmd is plain ASCII on purpose. The host exits on its own when the browser's stdin
# ends, so nothing has to sit between Chromium and Node.
#
# A host started by the old installer is a running sourcecapsule-host.exe that holds its
# own file open. Stop it so the cleanup below cannot hit a locked file; the browser
# reconnects on its own through the service worker's reconnect alarm.
Get-Process -Name 'sourcecapsule-host' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping old launcher (pid $($_.Id))"
    $_ | Stop-Process -Force
}
foreach ($stale in @($hostExe, (Join-Path $hostDir 'node-path.txt'))) {
    if (Test-Path $stale) {
        Start-Sleep -Milliseconds 500
        Remove-Item $stale -Force
        Write-Host "Removed $stale"
    }
}
$cmdText = "@echo off`r`n`"$nodeExe`" `"%~dp0sourcecapsule-host.mjs`" %*`r`n"
[System.IO.File]::WriteAllText($hostCmd, $cmdText, (New-Object System.Text.ASCIIEncoding))
Write-Host "Wrote $hostCmd"

$manifest = [ordered]@{
    name           = $hostName
    description    = 'SourceCapsule local automation bridge'
    path           = $hostCmd
    type           = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
# Chrome rejects a native host manifest that starts with a UTF-8 BOM, and PowerShell
# 5.1's `Set-Content -Encoding utf8` always writes one. Write the bytes directly.
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $manifestPath"

# A shell started from inside a packaged (MSIX) app, such as the Claude desktop app,
# silently redirects these writes, and the registry keys below, into that app's private
# copy. The install then looks fine from this shell, while a browser started from the
# desktop finds no host at all. Detect the redirected copy and refuse to report success.
$packageCopies = Join-Path $env:LOCALAPPDATA "Packages\*\LocalCache\Local\SourceCapsule\native-host\$hostName.json"
$redirected = @(Resolve-Path -Path $packageCopies -ErrorAction SilentlyContinue |
    Get-Item | Where-Object { $_.LastWriteTime -ge $startedAt })
if ($redirected.Count -gt 0) {
    throw ("This PowerShell runs inside an app container, so the install landed in " +
        "$($redirected[0].DirectoryName), which a normally started browser cannot see. " +
        'Re-run this script from a PowerShell window opened from the Start menu.')
}

foreach ($root in $registryRoots) {
    $key = Join-Path $root $hostName
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestPath
    Write-Host "Registered $key"
}

Write-Host ''
Write-Host 'SourceCapsule native host registered for the current user.'
Write-Host "Extension ID expected: $ExtensionId"
Write-Host 'Reload the extension in chrome://extensions, then verify with:'
Write-Host '  node scripts\sourcecapsule-capture.mjs --ping'
