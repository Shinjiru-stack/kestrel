Add-Type -AssemblyName System.Drawing

$icons = Join-Path $PSScriptRoot '..\crates\kestrel\icons'
New-Item -ItemType Directory -Force -Path $icons | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-MarkPath {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.StartFigure()
  $path.AddLine(272, 236.8, 272, 787.2)
  $path.StartFigure()
  $path.AddBezier(272, 512, 406, 410, 557, 294, 733, 227)
  $path.StartFigure()
  $path.AddBezier(272, 512, 406, 614, 557, 730, 733, 797)
  return $path
}

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$bmp.SetResolution(96, 96)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$bgPath = New-RoundedPath 40 40 944 944 210
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(40, 40)),
  (New-Object System.Drawing.Point(984, 984)),
  [System.Drawing.Color]::FromArgb(255, 19, 30, 24),
  [System.Drawing.Color]::FromArgb(255, 6, 10, 8)
)
$g.FillPath($bgBrush, $bgPath)

$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(34, 158, 240, 192), 6)
$g.DrawPath($borderPen, $bgPath)

$markPath = New-MarkPath
$mint = [System.Drawing.Color]::FromArgb(255, 158, 240, 192)
$mintBright = [System.Drawing.Color]::FromArgb(255, 216, 255, 231)
$mintGlow = [System.Drawing.Color]::FromArgb(42, 158, 240, 192)

$glowPen = New-Object System.Drawing.Pen($mintGlow, 150)
$glowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$glowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($glowPen, $markPath)

$markPen = New-Object System.Drawing.Pen($mint, 73.6)
$markPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$markPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$markPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($markPen, $markPath)

$brightPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 216, 255, 231), 22)
$brightPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$brightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$brightPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($brightPen, $markPath)

$eyeBrush = New-Object System.Drawing.SolidBrush($mintBright)
$g.FillEllipse($eyeBrush, 697.6, 163.2, 115.2, 115.2)

$nodeBrush = New-Object System.Drawing.SolidBrush($mint)
$g.FillEllipse($nodeBrush, 235.2, 475.2, 73.6, 73.6)

$source = Join-Path $icons 'icon-source.png'
$bmp.Save($source, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$bgBrush.Dispose()
$bgPath.Dispose()
$borderPen.Dispose()
$markPath.Dispose()
$glowPen.Dispose()
$markPen.Dispose()
$brightPen.Dispose()
$eyeBrush.Dispose()
$nodeBrush.Dispose()

function Resize-Png([string]$src, [string]$dst, [int]$px) {
  $image = [System.Drawing.Image]::FromFile($src)
  $out = New-Object System.Drawing.Bitmap($px, $px)
  $out.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($out)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($image, 0, 0, $px, $px)
  $out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $out.Dispose()
  $image.Dispose()
}

$sizes = @{
  'icon.png' = 512
  '128x128@2x.png' = 256
  '128x128.png' = 128
  '64x64.png' = 64
  '48x48.png' = 48
  '32x32.png' = 32
  '16x16.png' = 16
}
foreach ($entry in $sizes.GetEnumerator()) {
  Resize-Png $source (Join-Path $icons $entry.Key) $entry.Value
}

# Multi-resolution ICO: 16, 32, 48, 64, 128, 256.
$icoSizes = @(16, 32, 48, 64, 128, 256)
$images = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($px in $icoSizes) {
  $icoPng = Join-Path $icons ("icon-{0}.png" -f $px)
  Resize-Png $source $icoPng $px
  $images.Add([System.IO.File]::ReadAllBytes($icoPng))
}

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$icoSizes.Count)
$offset = 6 + (16 * $icoSizes.Count)
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
  $px = $icoSizes[$i]
  $writer.Write([Byte]($(if ($px -ge 256) { 0 } else { $px })))
  $writer.Write([Byte]($(if ($px -ge 256) { 0 } else { $px })))
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$images[$i].Length)
  $writer.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($image in $images) {
  $writer.Write($image)
}
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $icons 'icon.ico'), $stream.ToArray())
$writer.Dispose()
$stream.Dispose()

Remove-Item (Join-Path $icons 'icon-16.png') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $icons 'icon-32.png') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $icons 'icon-48.png') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $icons 'icon-64.png') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $icons 'icon-128.png') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $icons 'icon-256.png') -ErrorAction SilentlyContinue

Write-Output "Generated Kestrel icons in $icons"
Get-ChildItem $icons | Select-Object Name, Length | Format-Table -AutoSize
