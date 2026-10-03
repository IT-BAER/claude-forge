$ErrorActionPreference = 'Stop'
$modRoot = Split-Path $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('file-explorer-fileop-' + [guid]::NewGuid().ToString('N'))
$project = Join-Path $testRoot 'project'
[IO.Directory]::CreateDirectory((Join-Path $project 'sub')) | Out-Null
$passed = 0
function Check($condition, $label) {
    if (!$condition) { throw "FAIL: $label" }
    $script:passed++
}
function Op($op, $path, $name = '') {
    $arguments = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $modRoot 'hooks/file-op.ps1'), '-Op', $op, '-Path', $path, '-RootPath', $project)
    if ($name) { $arguments += @('-Name', $name) }
    $output = & powershell.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "file-op.ps1 exited with $LASTEXITCODE" }
    return $output | ConvertFrom-Json
}
try {
    $file = Join-Path $project 'a.txt'
    [IO.File]::WriteAllText($file, 'content')

    $renamed = Op 'rename' $file 'b.txt'
    Check ($renamed.ok -eq $true -and !(Test-Path $file) -and (Get-Content (Join-Path $project 'b.txt') -Raw) -ceq 'content') 'rename moves the file'
    [IO.File]::WriteAllText((Join-Path $project 'c.txt'), 'other')
    $clash = Op 'rename' (Join-Path $project 'b.txt') 'c.txt'
    Check (!$clash.ok -and (Get-Content (Join-Path $project 'c.txt') -Raw) -ceq 'other') 'rename refuses an existing name'
    $bad = Op 'rename' (Join-Path $project 'b.txt') '..\escape.txt'
    Check (!$bad.ok -and (Test-Path (Join-Path $project 'b.txt'))) 'rename refuses a path in the name'
    $case = Op 'rename' (Join-Path $project 'b.txt') 'B.txt'
    Check ($case.ok -eq $true -and (Get-ChildItem $project -Name) -ccontains 'B.txt') 'rename allows a case-only change'

    $outside = Join-Path $testRoot 'outside.txt'
    [IO.File]::WriteAllText($outside, 'outside')
    Check (!(Op 'rename' $outside 'x.txt').ok -and (Test-Path $outside)) 'rename refuses a path outside the root'
    Check (!(Op 'delete' $outside).ok -and (Test-Path $outside)) 'delete refuses a path outside the root'
    Check (!(Op 'delete' $project).ok -and (Test-Path $project)) 'delete refuses the root itself'

    $copy = Op 'duplicate' (Join-Path $project 'B.txt')
    Check ($copy.ok -eq $true -and (Get-Content (Join-Path $project 'B copy.txt') -Raw) -ceq 'content') 'duplicate writes "name copy.ext"'
    $copy2 = Op 'duplicate' (Join-Path $project 'B.txt')
    Check ($copy2.ok -eq $true -and (Test-Path (Join-Path $project 'B copy 2.txt'))) 'duplicate numbers further copies'

    $newFile = Op 'newfile' (Join-Path $project 'sub') 'n.md'
    Check ($newFile.ok -eq $true -and (Test-Path (Join-Path $project 'sub/n.md')) -and (Get-Item (Join-Path $project 'sub/n.md')).Length -eq 0) 'newfile creates an empty file in the folder'
    Check (!(Op 'newfile' (Join-Path $project 'sub') 'n.md').ok) 'newfile refuses an existing name'
    $newDir = Op 'newfolder' $project 'made'
    Check ($newDir.ok -eq $true -and (Test-Path (Join-Path $project 'made') -PathType Container)) 'newfolder creates a folder in the root'

    $name = 'fileop-' + [guid]::NewGuid().ToString('N') + '.txt'
    $doomed = Join-Path $project $name
    [IO.File]::WriteAllText($doomed, 'bye')
    $deleted = Op 'delete' $doomed
    Check ($deleted.ok -eq $true -and !(Test-Path $doomed)) 'delete removes the file'
    $bin = (New-Object -ComObject Shell.Application).NameSpace(0xA).Items() | Where-Object { $_.Name -eq $name -or $_.Name -eq [IO.Path]::GetFileNameWithoutExtension($name) }
    Check ($null -ne $bin) 'delete sent the file to the Recycle Bin'
    $bin | ForEach-Object { Remove-Item -LiteralPath $_.Path -Force -ErrorAction SilentlyContinue }

    $dir = Join-Path $project 'tree'
    [IO.Directory]::CreateDirectory((Join-Path $dir 'inner')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $dir 'inner/f.txt'), 'x')
    Check ((Op 'duplicate' $dir).ok -eq $true -and (Test-Path (Join-Path $project 'tree copy/inner/f.txt'))) 'duplicate copies a folder recursively'
    Check ((Op 'delete' $dir).ok -eq $true -and !(Test-Path $dir)) 'delete removes a folder'

    $link = Join-Path $project 'jlink'
    New-Item -ItemType Junction -Path $link -Target (Split-Path $outside) | Out-Null
    Check (!(Op 'delete' $link).ok -and (Test-Path $outside)) 'delete refuses a junction'
    [IO.Directory]::Delete($link)
    [pscustomobject]@{ Passed = $passed; FixtureRoot = $testRoot } | ConvertTo-Json -Compress
} finally {
    if (Test-Path $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
