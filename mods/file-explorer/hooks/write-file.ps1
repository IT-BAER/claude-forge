param([Parameter(Mandatory)][string]$FilePath, [Parameter(Mandatory)][string]$RootPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'file-text.ps1')
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$stream = $null
$result = @{ ok = $false; conflict = $false; message = 'Save failed.' }
try {
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -gt 200000) { throw 'Save input is too large.' }
    $data = $inputText | ConvertFrom-Json
    if ($data.text -isnot [string] -or $data.text.Length -gt 30000 -or $data.hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid save request.' }
    if ($data.text -match '[\x00-\x08\x0b-\x1f\x7f-\x9f]') { throw 'Unsupported control characters.' }
    $stream = [IO.FileStream]::new($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    AssertHandleInRoot $stream $RootPath
    if ($stream.Length -gt 2 * 1024 * 1024) { throw 'File exceeds the editing size limit.' }
    $original = [byte[]]::new([int]$stream.Length)
    $count = 0
    while ($count -lt $original.Length) {
        $received = $stream.Read($original, $count, $original.Length - $count)
        if (!$received) { throw 'File could not be read completely.' }
        $count += $received
    }
    if ((GetBytesHash $original $count) -cne $data.hash) {
        $result = @{ ok = $false; conflict = $true; message = 'File changed on disk. Your draft is kept; reopen the file before saving.' }
    } else {
        $metadata = GetTextMetadata $original $count
        if (!$metadata.editable -or $metadata.encoding -cne $data.encoding -or $metadata.eol -cne $data.eol) { throw 'File encoding or line endings changed.' }
        $text = $data.text.Replace("`r`n", "`n").Replace("`r", "`n")
        if ($metadata.eol -eq 'crlf') { $text = $text.Replace("`n", "`r`n") }
        elseif ($metadata.eol -eq 'cr') { $text = $text.Replace("`n", "`r") }
        $encoding = GetTextEncoding $metadata.encoding
        $encoded = $encoding.GetBytes($text)
        $preamble = $encoding.GetPreamble()
        $bytes = [byte[]]::new($preamble.Length + $encoded.Length)
        [Array]::Copy($preamble, 0, $bytes, 0, $preamble.Length)
        [Array]::Copy($encoded, 0, $bytes, $preamble.Length, $encoded.Length)
        try {
            $stream.Position = 0
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.SetLength($bytes.Length)
            $stream.Flush($true)
        } catch {
            $failure = $_
            try { $stream.Position = 0; $stream.Write($original, 0, $original.Length); $stream.SetLength($original.Length); $stream.Flush($true) }
            catch { throw 'Save and restoration both failed. Keep the draft and check the file on disk.' }
            throw $failure
        }
        $result = @{ ok = $true; hash = (GetBytesHash $bytes $bytes.Length) }
    }
} catch {
    $result = @{ ok = $false; conflict = $false; message = $_.Exception.Message }
} finally {
    if ($null -ne $stream) { $stream.Dispose() }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
