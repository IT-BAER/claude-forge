param([Parameter(Mandatory)][string]$FilePath, [string]$RootPath = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'file-text.ps1')
$limit = 2 * 1024 * 1024
$stream = [IO.FileStream]::new($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try {
    AssertHandleInRoot $stream $RootPath
    $buffer = [byte[]]::new($limit + 1)
    $count = 0
    while ($count -lt $buffer.Length) {
        $received = $stream.Read($buffer, $count, $buffer.Length - $count)
        if ($received -eq 0) { break }
        $count += $received
    }
    if ($count -gt $limit) {
        $result = @{ kind = 'unsupported'; content = 'File exceeds the text preview size limit (2 MiB).'; truncated = $false }
    } else {
        try {
            $result = GetTextMetadata $buffer $count
            $result.kind = 'text'
            $result.hash = GetBytesHash $buffer $count
        } catch {
            $result = @{ kind = 'unsupported'; content = 'Binary file or unsupported encoding. Text editing is not available.'; truncated = $false }
        }
    }
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::Out.Write(($result | ConvertTo-Json -Compress))
} finally {
    $stream.Dispose()
}
