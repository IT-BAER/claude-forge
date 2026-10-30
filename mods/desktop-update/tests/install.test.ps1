$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path $PSScriptRoot) 'hooks/install-update.ps1'
$sha = 'ab' * 32
$passed = 0
function Check($condition, $label) {
    if (!$condition) { throw "FAIL: $label" }
    $script:passed++
}
# Every case is refused before any download, so the test needs no network
function Run([string[]]$extra) {
    $null = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @extra 2>&1
    return $LASTEXITCODE
}

Check ((Run @('-Url', 'https://example.com/Claude.msix', '-Sha256', $sha, '-Version', '4.1.0', '-NoInstall')) -eq 2) 'refuses a download host other than downloads.claude.ai'
Check ((Run @('-Url', 'https://downloads.claude.ai/a.msix" -Evil "x', '-Sha256', $sha, '-Version', '4.1.0', '-NoInstall')) -eq 2) 'refuses a URL with a quote'
Check ((Run @('-Url', 'https://downloads.claude.ai/a b.msix', '-Sha256', $sha, '-Version', '4.1.0', '-NoInstall')) -eq 2) 'refuses a URL with a space'
Check ((Run @('-Url', 'https://downloads.claude.ai/a.msix', '-Sha256', 'xyz', '-Version', '4.1.0', '-NoInstall')) -ne 0) 'refuses a malformed SHA256'
Check ((Run @('-Url', 'https://downloads.claude.ai/a.msix', '-Sha256', $sha, '-Version', '4.1', '-NoInstall')) -ne 0) 'refuses a malformed version'
Check ((Run @('-Url', 'https://example.com/Claude.msix', '-Sha256', $sha, '-Version', '4.1.0', '-Detach', '-NoInstall')) -eq 2) 'refuses before detaching'

# The download fails (bad path or no network) after the start line, which names the relaunch command
$realLocal = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path ([IO.Path]::GetTempPath()) "desktop-update-test-$PID"
try {
    $dir = Join-Path $env:LOCALAPPDATA 'claude-desktop-update'
    $log = Join-Path $dir 'install.log'
    $null = Run @('-Url', 'https://downloads.claude.ai/desktop-update-test.msix', '-Sha256', $sha, '-Version', '4.1.0', '-NoInstall', '-Relaunch', 'from-option')
    Check ((Get-Content $log -Raw) -match 'relaunch: from-option') 'uses the relaunch option without a local relaunch.cmd'
    Remove-Item $log
    Set-Content -Path (Join-Path $dir 'relaunch.cmd') -Value '@echo off'
    $null = Run @('-Url', 'https://downloads.claude.ai/desktop-update-test.msix', '-Sha256', $sha, '-Version', '4.1.0', '-NoInstall', '-Relaunch', 'from-option')
    Check ((Get-Content $log -Raw) -match [regex]::Escape("relaunch: `"$(Join-Path $dir 'relaunch.cmd')`"")) 'a local relaunch.cmd wins over the option'
} finally {
    Remove-Item -Recurse -Force $env:LOCALAPPDATA -ErrorAction SilentlyContinue
    $env:LOCALAPPDATA = $realLocal
}

Write-Output "$passed passed"
