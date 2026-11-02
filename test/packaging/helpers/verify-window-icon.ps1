param(
  [Parameter(Mandatory = $true)][long]$WindowHandle,
  [Parameter(Mandatory = $true)][string]$ExpectedIcon,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ManuslipWindowIcon {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
    IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
'@
$windowIcon = [IntPtr]::Zero
foreach ($kind in @(0, 1, 2)) {
  $success = [ManuslipWindowIcon]::SendMessageTimeout(
    [IntPtr]$WindowHandle, 0x7f, [IntPtr]$kind, [IntPtr]::Zero, 2, 1000, [ref]$windowIcon)
  if ($success -ne [IntPtr]::Zero -and $windowIcon -ne [IntPtr]::Zero) { break }
}
if ($windowIcon -eq [IntPtr]::Zero) { throw 'Application window has no native icon' }
$icon = [System.Drawing.Icon]::FromHandle($windowIcon)
$actual = $icon.ToBitmap()
$source = [System.Drawing.Bitmap]::FromFile($ExpectedIcon)
$expected = New-Object System.Drawing.Bitmap($actual.Width, $actual.Height)
$graphics = [System.Drawing.Graphics]::FromImage($expected)
try {
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($source, 0, 0, $actual.Width, $actual.Height)
  $errorSum = 0.0
  for ($y = 0; $y -lt $actual.Height; $y++) {
    for ($x = 0; $x -lt $actual.Width; $x++) {
      $pixel = $actual.GetPixel($x, $y)
      $reference = $expected.GetPixel($x, $y)
      # Compare premultiplied colors so invisible RGB does not affect the result.
      $errorSum += [Math]::Abs($pixel.A - $reference.A)
      $errorSum += [Math]::Abs($pixel.R * $pixel.A / 255.0 - $reference.R * $reference.A / 255.0)
      $errorSum += [Math]::Abs($pixel.G * $pixel.A / 255.0 - $reference.G * $reference.A / 255.0)
      $errorSum += [Math]::Abs($pixel.B * $pixel.A / 255.0 - $reference.B * $reference.A / 255.0)
    }
  }
  $meanError = $errorSum / ($actual.Width * $actual.Height * 4)
  # Native downsampling and GDI+ differ at edges; the complete image must still agree.
  if ($meanError -gt 5) { throw "Wrong application window icon: mean channel error $meanError" }
  $actual.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  @{ width = $actual.Width; height = $actual.Height; meanChannelError = $meanError } | ConvertTo-Json -Compress
} finally {
  $graphics.Dispose()
  $expected.Dispose()
  $source.Dispose()
  $actual.Dispose()
  $icon.Dispose()
}
