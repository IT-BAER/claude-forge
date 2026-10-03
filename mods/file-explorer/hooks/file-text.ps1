function GetTextEncoding([string]$name) {
    switch ($name) {
        'utf8' { return [Text.UTF8Encoding]::new($false, $true) }
        'utf8bom' { return [Text.UTF8Encoding]::new($true, $true) }
        'utf16le' { return [Text.UnicodeEncoding]::new($false, $true, $true) }
        'utf16be' { return [Text.UnicodeEncoding]::new($true, $true, $true) }
        default { throw 'Unsupported text encoding.' }
    }
}

function GetTextMetadata([byte[]]$bytes, [int]$count) {
    $name = 'utf8'
    $offset = 0
    if ($count -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $name = 'utf8bom'; $offset = 3 }
    elseif ($count -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { $name = 'utf16le'; $offset = 2 }
    elseif ($count -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { $name = 'utf16be'; $offset = 2 }
    $encoding = GetTextEncoding $name
    $text = $encoding.GetString($bytes, $offset, $count - $offset)
    if ($text.IndexOf([char]0) -ge 0) { throw 'Binary file. Text preview is not available.' }
    $breaks = @([regex]::Matches($text, "`r`n|`r|`n") | ForEach-Object { $_.Value } | Sort-Object -Unique)
    $eol = 'lf'
    if ($breaks.Count -gt 1) { $eol = 'mixed' }
    elseif ($breaks.Count -eq 1 -and $breaks[0] -eq "`r`n") { $eol = 'crlf' }
    elseif ($breaks.Count -eq 1 -and $breaks[0] -eq "`r") { $eol = 'cr' }
    $normalized = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    $clean = [regex]::Replace($normalized, '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '')
    $length = [Math]::Min(30000, $clean.Length)
    if ($length -gt 0 -and [char]::IsHighSurrogate($clean[$length - 1])) { $length-- }
    $editable = $normalized.Length -le 30000 -and $clean -ceq $normalized -and $eol -ne 'mixed'
    $notice = ''
    if ($normalized.Length -gt 30000) { $notice = 'Read-only: file exceeds the editor limit (30,000 characters). Preview truncated.' }
    elseif ($eol -eq 'mixed') { $notice = 'Read-only: mixed line endings are preserved on disk.' }
    elseif ($clean -cne $normalized) { $notice = 'Read-only: unsupported control characters.' }
    return @{ encoding = $name; eol = $eol; draft = $(if ($editable) { $normalized } else { '' });
        content = $clean.Substring(0, $length); editable = $editable; truncated = $clean.Length -gt $length; notice = $notice }
}

function GetBytesHash([byte[]]$bytes, [int]$count) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($bytes, 0, $count)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function AssertHandleInRoot($stream, [string]$root) {
    if (!$root) { return }
    if (!('FileExplorerPath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class FileExplorerPath {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
}
'@
    }
    $buffer = [Text.StringBuilder]::new(32768)
    $length = [FileExplorerPath]::GetFinalPathNameByHandle($stream.SafeFileHandle, $buffer, $buffer.Capacity, 0)
    if (!$length -or $length -ge $buffer.Capacity) { throw 'Cannot verify the file location.' }
    $actual = $buffer.ToString()
    if ($actual.StartsWith('\\?\UNC\')) { $actual = '\\' + $actual.Substring(8) }
    elseif ($actual.StartsWith('\\?\')) { $actual = $actual.Substring(4) }
    $boundary = [IO.Path]::GetFullPath($root).TrimEnd('\', '/') + '\'
    if (!$actual.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'File is outside the explorer root.' }
}
