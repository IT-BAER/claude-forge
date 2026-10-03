param([Parameter(Mandatory)][string]$FilePath)
$ErrorActionPreference = 'Stop'
$limit = 2 * 1024 * 1024
$stream = [IO.FileStream]::new($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try {
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
        $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $count)
        if ($text.IndexOf([char]0) -ge 0) {
            $result = @{ kind = 'unsupported'; content = 'Binary file. Text preview is not available.'; truncated = $false }
        } else {
            $clean = [regex]::Replace($text, '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '')
            $length = [Math]::Min(9500, $clean.Length)
            if ($length -gt 0 -and [char]::IsHighSurrogate($clean[$length - 1])) { $length-- }
            $result = @{ kind = 'text'; content = $clean.Substring(0, $length); truncated = $clean.Length -gt 9500 }
        }
    }
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::Out.Write(($result | ConvertTo-Json -Compress))
} finally {
    $stream.Dispose()
}
