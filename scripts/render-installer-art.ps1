$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'resources\installer'
$iconPath = Join-Path $root 'resources\icons\orelle-256.png'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-TextFormat([int]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  $font = New-Object System.Drawing.Font('Segoe UI', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Near
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  return @{ Font = $font; Format = $format }
}

function Save-Bitmap($bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bitmap.Dispose()
}

$sidebar = New-Object System.Drawing.Bitmap(164, 314)
$g = [System.Drawing.Graphics]::FromImage($sidebar)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(22, 25, 35))
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Rectangle(0, 0, 164, 314)),
  [System.Drawing.Color]::FromArgb(29, 33, 48),
  [System.Drawing.Color]::FromArgb(11, 13, 20),
  90)
$g.FillRectangle($brush, 0, 0, 164, 314)
$brush.Dispose()
$icon = [System.Drawing.Image]::FromFile($iconPath)
$g.DrawImage($icon, (New-Object System.Drawing.Rectangle(48, 38, 68, 68)))
$icon.Dispose()
$gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 179, 61))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 196, 210))
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$fmtBrand = New-TextFormat 22 ([System.Drawing.FontStyle]::Bold)
$fmtBody = New-TextFormat 12
$g.DrawString('ORELLE', $fmtBrand.Font, $white, 36, 124, $fmtBrand.Format)
$g.DrawString('A calmer desktop.', $fmtBody.Font, $muted, 27, 160, $fmtBody.Format)
$g.DrawString('Private - reversible - yours', $fmtBody.Font, $muted, 16, 181, $fmtBody.Format)
$g.FillRectangle($gold, 28, 214, 108, 3)
$g.DrawString('Windows 11', $fmtBody.Font, $gold, 50, 238, $fmtBody.Format)
$fmtBrand.Font.Dispose(); $fmtBrand.Format.Dispose(); $fmtBody.Font.Dispose(); $fmtBody.Format.Dispose()
$gold.Dispose(); $muted.Dispose(); $white.Dispose(); $g.Dispose()
Save-Bitmap $sidebar (Join-Path $outDir 'installerSidebar.bmp')

$header = New-Object System.Drawing.Bitmap(150, 57)
$g = [System.Drawing.Graphics]::FromImage($header)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(22, 25, 35))
$icon = [System.Drawing.Image]::FromFile($iconPath)
$g.DrawImage($icon, (New-Object System.Drawing.Rectangle(16, 9, 38, 38)))
$icon.Dispose()
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 179, 61))
$fmt = New-TextFormat 15 ([System.Drawing.FontStyle]::Bold)
$fmtSub = New-TextFormat 9
$g.DrawString('Orelle', $fmt.Font, $white, 65, 10, $fmt.Format)
$g.DrawString('Installation', $fmtSub.Font, $gold, 66, 31, $fmtSub.Format)
$g.FillRectangle($gold, 0, 55, 150, 2)
$fmt.Font.Dispose(); $fmt.Format.Dispose(); $fmtSub.Font.Dispose(); $fmtSub.Format.Dispose(); $white.Dispose(); $gold.Dispose(); $g.Dispose()
Save-Bitmap $header (Join-Path $outDir 'installerHeader.bmp')

Write-Output 'Installer artwork written.'
