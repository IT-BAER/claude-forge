$ErrorActionPreference = 'Stop'
$modRoot = Split-Path $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('file-explorer-fileio-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$project = Join-Path $testRoot 'project'
[IO.Directory]::CreateDirectory($project) | Out-Null
$path = Join-Path $project 'notes.md'
$passed = 0
function Check($condition, $label) {
    if (!$condition) { throw "FAIL: $label" }
    $script:passed++
}
function ReadFile($file) {
    $output = & powershell.exe -NoProfile -NonInteractive -File (Join-Path $modRoot 'hooks/read-preview.ps1') -FilePath $file
    if ($LASTEXITCODE -ne 0) { throw 'Read helper failed' }
    return $output | ConvertFrom-Json
}
function SaveFile($file, $root, $data) {
    $info = [Diagnostics.ProcessStartInfo]::new('powershell.exe')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($arg in @('-NoProfile', '-NonInteractive', '-File', (Join-Path $modRoot 'hooks/write-file.ps1'), '-FilePath', $file, '-RootPath', $root)) { $info.ArgumentList.Add($arg) }
    $process = [Diagnostics.Process]::Start($info)
    $process.StandardInput.Write(($data | ConvertTo-Json -Compress))
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Write helper failed: $errorText" }
    $process.Dispose()
    return $output | ConvertFrom-Json
}
$original = "# Original`r`n`r`nLine`r`n"
$utf8bom = [Text.UTF8Encoding]::new($true, $true)
[IO.File]::WriteAllText($path, $original, $utf8bom)
$read = ReadFile $path
Check ($read.editable -eq $true -and $read.encoding -eq 'utf8bom' -and $read.eol -eq 'crlf') 'UTF8 BOM and CRLF detected'
Check ($read.draft -ceq $original.Replace("`r`n", "`n")) 'Full editable buffer is normalized without truncation'
$draft = "# Saved`n`n$([char]0x00e4) $([char]0x6f22)`n"
$saved = SaveFile $path $project @{ hash = $read.hash; text = $draft; encoding = $read.encoding; eol = $read.eol }
Check ($saved.ok -eq $true) 'Explicit save succeeds'
$bytes = [IO.File]::ReadAllBytes($path)
Check ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) 'UTF8 BOM preserved'
Check ([IO.File]::ReadAllText($path) -ceq $draft.Replace("`n", "`r`n")) 'Unicode and CRLF preserved end to end'
$conflict = SaveFile $path $project @{ hash = $read.hash; text = 'must not overwrite'; encoding = 'utf8bom'; eol = 'crlf' }
Check ($conflict.conflict -eq $true) 'Stale hash rejected'
Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -ceq [Convert]::ToBase64String($bytes)) 'Conflict leaves disk bytes unchanged'
$utf16 = Join-Path $project 'utf16.txt'
[IO.File]::WriteAllText($utf16, "old`n", [Text.UnicodeEncoding]::new($false, $true, $true))
$read16 = ReadFile $utf16
Check ($read16.editable -eq $true -and $read16.encoding -eq 'utf16le') 'UTF16 decoded as editable text'
$saved16 = SaveFile $utf16 $project @{ hash = $read16.hash; text = "new`n"; encoding = $read16.encoding; eol = $read16.eol }
Check ($saved16.ok -eq $true -and [IO.File]::ReadAllText($utf16) -ceq "new`n") 'UTF16 save preserves content and encoding'
[IO.File]::WriteAllText($path, 'x' * 30001, [Text.UTF8Encoding]::new($false))
$large = ReadFile $path
Check (!$large.editable -and $large.truncated -and $large.content.Length -le 30000) 'Oversized text cannot be saved from a truncated buffer'
[IO.File]::WriteAllBytes($path, [byte[]]@(0, 1, 2, 3))
Check ((ReadFile $path).kind -eq 'unsupported') 'Binary input remains unsupported'
$outside = Join-Path $testRoot 'outside.txt'
[IO.File]::WriteAllText($outside, 'outside')
$outsideRead = ReadFile $outside
$outsideSave = SaveFile $outside $project @{ hash = $outsideRead.hash; text = 'changed'; encoding = 'utf8'; eol = 'lf' }
Check (!$outsideSave.ok -and [IO.File]::ReadAllText($outside) -ceq 'outside') 'Root escape rejected without changing outside file'
[IO.File]::WriteAllText($path, "mixed`r`nend`n", [Text.UTF8Encoding]::new($false))
$mixed = ReadFile $path
Check (!$mixed.editable -and $mixed.eol -eq 'mixed') 'Mixed line endings remain read-only'
$mixedSave = SaveFile $path $project @{ hash = $mixed.hash; text = 'changed'; encoding = 'utf8'; eol = 'mixed' }
Check (!$mixedSave.ok -and [IO.File]::ReadAllText($path) -ceq "mixed`r`nend`n") 'Read-only metadata is enforced by the writer'
[IO.File]::WriteAllText($path, 'locked', [Text.UTF8Encoding]::new($false))
$lockedRead = ReadFile $path
$lock = [IO.FileStream]::new($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $lockedSave = SaveFile $path $project @{ hash = $lockedRead.hash; text = 'changed'; encoding = 'utf8'; eol = 'lf' }
    Check (!$lockedSave.ok) 'An existing exclusive writer prevents saving'
} finally { $lock.Dispose() }
Check ([IO.File]::ReadAllText($path) -ceq 'locked') 'Lock failure leaves file content unchanged'
$outsideDir = Join-Path $testRoot 'outside-dir'
[IO.Directory]::CreateDirectory($outsideDir) | Out-Null
$target = Join-Path $outsideDir 'linked.txt'
[IO.File]::WriteAllText($target, 'outside link')
$junction = Join-Path $project 'junction'
New-Item -ItemType Junction -Path $junction -Target $outsideDir | Out-Null
$linkedRead = ReadFile $target
$linkedSave = SaveFile (Join-Path $junction 'linked.txt') $project @{ hash = $linkedRead.hash; text = 'changed'; encoding = 'utf8'; eol = 'lf' }
Check (!$linkedSave.ok -and [IO.File]::ReadAllText($target) -ceq 'outside link') 'Opened-handle validation rejects a junction escaping the project'
[pscustomobject]@{ Passed = $passed; FixtureRoot = $testRoot } | ConvertTo-Json -Compress
