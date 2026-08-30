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

$hostName = 'com.wolfgang_aura.sourcecapsule'
$repoRoot = Split-Path -Parent $PSScriptRoot
$hostDir = Join-Path $repoRoot 'native-host'
$hostScript = Join-Path $hostDir 'sourcecapsule-host.mjs'
$hostCmd = Join-Path $hostDir 'sourcecapsule-host.cmd'
$hostExe = Join-Path $hostDir 'sourcecapsule-host.exe'
$launcherSource = Join-Path $hostDir 'launcher.cs'
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

if (-not (Test-Path $hostScript)) {
    throw "Host script not found: $hostScript"
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($null -eq $node) {
    throw 'node was not found on PATH. Install Node 18+ and re-run.'
}
$nodeExe = $node.Source
Write-Host "Node: $nodeExe"

# Chromium is unreliable about launching .bat/.cmd native hosts on Windows, so the
# registered host is a real executable built from native-host/launcher.cs with the .NET
# compiler that ships with Windows. No toolchain to install. The launcher does nothing
# but start Node and shuttle the raw stdio streams.
$nodePathFile = Join-Path $hostDir 'node-path.txt'
[System.IO.File]::WriteAllText($nodePathFile, $nodeExe, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $hostExe) {
    Remove-Item $hostExe -Force
}
Add-Type -TypeDefinition (Get-Content $launcherSource -Raw) `
    -OutputAssembly $hostExe -OutputType ConsoleApplication
if (-not (Test-Path $hostExe)) {
    throw "Failed to build $hostExe"
}
Write-Host "Built $hostExe"

# The old batch wrapper would still be registered in stale manifests; remove it so there
# is exactly one host binary on disk.
if (Test-Path $hostCmd) {
    Remove-Item $hostCmd -Force
}

$manifest = [ordered]@{
    name           = $hostName
    description    = 'SourceCapsule local automation bridge'
    path           = $hostExe
    type           = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
# Chrome rejects a native host manifest that starts with a UTF-8 BOM, and PowerShell
# 5.1's `Set-Content -Encoding utf8` always writes one. Write the bytes directly.
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $manifestPath"

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
