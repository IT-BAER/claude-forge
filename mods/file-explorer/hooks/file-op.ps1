param(
    [Parameter(Mandatory)][ValidateSet('rename', 'delete', 'duplicate', 'newfile', 'newfolder')][string]$Op,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$RootPath,
    [string]$Name = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$result = @{ ok = $false; message = 'Operation failed.' }
$separator = [IO.Path]::DirectorySeparatorChar
$root = [IO.Path]::GetFullPath($RootPath).TrimEnd('\', '/')
function IsInside([string]$p, [bool]$orRoot = $false) {
    $full = [IO.Path]::GetFullPath($p).TrimEnd('\', '/')
    if ($orRoot -and $full -ieq $root) { return $true }
    return $full.StartsWith($root + $separator, [StringComparison]::OrdinalIgnoreCase)
}
function AssertName([string]$n) {
    if (!$n -or $n -ne $n.Trim() -or $n -eq '.' -or $n -eq '..' -or $n.Length -gt 200 -or $n.EndsWith('.') -or $n.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw 'Invalid name.' }
}
try {
    $isDir = [IO.Directory]::Exists($Path)
    $isFile = [IO.File]::Exists($Path)
    if ($Op -in 'newfile', 'newfolder') {
        if (!$isDir -or !(IsInside $Path $true)) { throw 'Folder is missing or outside the explorer root.' }
        AssertName $Name
        $target = Join-Path $Path $Name
        if ([IO.File]::Exists($target) -or [IO.Directory]::Exists($target)) { throw 'An item with that name already exists.' }
        if ($Op -eq 'newfile') { [IO.File]::WriteAllBytes($target, [byte[]]@()) } else { [IO.Directory]::CreateDirectory($target) | Out-Null }
    } else {
        if (!($isDir -or $isFile) -or !(IsInside $Path)) { throw 'Item is missing or outside the explorer root.' }
        $item = Get-Item -LiteralPath $Path -Force
        $parent = Split-Path $Path
        switch ($Op) {
            'rename' {
                AssertName $Name
                $target = Join-Path $parent $Name
                $sameItem = $target -ieq $Path
                if (!$sameItem -and ([IO.File]::Exists($target) -or [IO.Directory]::Exists($target))) { throw 'An item with that name already exists.' }
                if ($isDir) { [IO.Directory]::Move($Path, $target) } else { [IO.File]::Move($Path, $target) }
            }
            'delete' {
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Links are not deleted from here.' }
                Add-Type -AssemblyName Microsoft.VisualBasic
                if ($isDir) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($Path, 'OnlyErrorDialogs', 'SendToRecycleBin') }
                else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, 'OnlyErrorDialogs', 'SendToRecycleBin') }
            }
            'duplicate' {
                $stem = if ($isDir) { $item.Name } else { [IO.Path]::GetFileNameWithoutExtension($item.Name) }
                $ext = if ($isDir) { '' } else { $item.Extension }
                $target = Join-Path $parent "$stem copy$ext"
                for ($n = 2; [IO.File]::Exists($target) -or [IO.Directory]::Exists($target); $n++) {
                    if ($n -gt 999) { throw 'Too many copies.' }
                    $target = Join-Path $parent "$stem copy $n$ext"
                }
                if ($isDir) { Copy-Item -LiteralPath $Path -Destination $target -Recurse } else { [IO.File]::Copy($Path, $target) }
            }
        }
    }
    $result = @{ ok = $true; message = ''; path = $target }
} catch {
    $result = @{ ok = $false; message = $_.Exception.Message }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
