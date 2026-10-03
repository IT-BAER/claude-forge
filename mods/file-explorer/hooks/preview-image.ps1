param([Parameter(Mandatory)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourceImage = $null
$sourceBytes = $null
try {
    $limit = 20 * 1024 * 1024
    $inputStream = [IO.FileStream]::new($ImagePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $buffer = [byte[]]::new($limit + 1)
        $count = 0
        while ($count -lt $buffer.Length) {
            $received = $inputStream.Read($buffer, $count, $buffer.Length - $count)
            if ($received -eq 0) { break }
            $count += $received
        }
        if ($count -gt $limit) { throw 'Image exceeds the preview size limit.' }
        $sourceBytes = [IO.MemoryStream]::new($buffer, 0, $count, $false)
    } finally {
        $inputStream.Dispose()
    }
    $sourceImage = [System.Drawing.Image]::FromStream($sourceBytes)
    if ([long]$sourceImage.Width * $sourceImage.Height -gt 40000000) { throw 'Image dimensions exceed the preview limit.' }
    $side = 600
    do {
        $scale = [Math]::Min(1.0, $side / [double][Math]::Max($sourceImage.Width, $sourceImage.Height))
        $imageWidth = [Math]::Max(1, [int]($sourceImage.Width * $scale))
        $imageHeight = [Math]::Max(1, [int]($sourceImage.Height * $scale))
        $thumbnail = [System.Drawing.Bitmap]::new($imageWidth, $imageHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($thumbnail)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($sourceImage, 0, 0, $imageWidth, $imageHeight)
            $thumbnail.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $encodedImage = [Convert]::ToBase64String($stream.ToArray())
        } finally {
            $graphics.Dispose()
            $thumbnail.Dispose()
            $stream.Dispose()
        }
        $side = [int]($side * 0.75)
    } while ($encodedImage.Length -gt 120000 -and $side -ge 32)
    if ($encodedImage.Length -gt 120000) { throw 'Image cannot fit the preview limit.' }
    [Console]::Out.Write('<svg xmlns="http://www.w3.org/2000/svg" width="' + $imageWidth + '" height="' + $imageHeight + '" viewBox="0 0 ' + $imageWidth + ' ' + $imageHeight + '"><image width="100%" height="100%" href="data:image/png;base64,' + $encodedImage + '"/></svg>')
} finally {
    if ($null -ne $sourceImage) { $sourceImage.Dispose() }
    if ($null -ne $sourceBytes) { $sourceBytes.Dispose() }
}
