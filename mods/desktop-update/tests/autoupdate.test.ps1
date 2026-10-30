$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path $PSScriptRoot) 'hooks/set-autoupdate.ps1'
$sid = 'S-1-5-21-1-2-3-1001'
$passed = 0
function Check($condition, $label) {
    if (!$condition) { throw "FAIL: $label" }
    $script:passed++
}
# Every case is refused before any elevation, so the test needs no UAC
function Run([string[]]$extra) {
    $null = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @extra 2>&1
    return $LASTEXITCODE
}

Check ((Run @('-Sid', 'S-1-5-18', '-Value', '1')) -eq 2) 'refuses a SID that is not a user account'
Check ((Run @('-Sid', "$sid\..\x", '-Value', '1')) -eq 2) 'refuses a SID with a path in it'
Check ((Run @('-Sid', "$sid /f", '-Value', '1')) -eq 2) 'refuses a SID with extra arguments'
Check ((Run @('-Sid', $sid, '-Value', '2')) -eq 2) 'refuses a value other than 0 or 1'
Check ((Run @('-Sid', 'S-1-5-18', '-Value', '1', '-Detach')) -eq 2) 'refuses before detaching'

Write-Output "$passed passed"
