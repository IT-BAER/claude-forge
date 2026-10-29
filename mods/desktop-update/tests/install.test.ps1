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

Write-Output "$passed passed"
