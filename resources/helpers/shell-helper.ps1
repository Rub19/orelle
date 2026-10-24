<#
  Orelle shell helper — read-only bridge to the Windows Shell.

  Modes:
    apps   Enumerates shell:AppsFolder (desktop + Store apps, same list as the Start menu)
           and writes a JSON array to stdout. Icons are extracted into -CacheDir.
    icons  Reads a JSON array of filesystem paths / shell parsing names from stdin and
           extracts their icons into -CacheDir. Writes { path: iconFile } JSON to stdout.

  This script never writes outside -CacheDir and never modifies the system.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('apps', 'icons')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$CacheDir,
  [int]$Size = 128,
  # apps mode: skip icon extraction (icons are then requested lazily with -Mode icons).
  [switch]$NoIcons
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class OrelleIcons {
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [StructLayout(LayoutKind.Sequential)]
  struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);

  // Returns true when an icon was written to outFile.
  public static bool Save(string parsingName, string outFile, int size) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory f;
    if (SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref iid, out f) != 0 || f == null) return false;
    IntPtr hbm;
    SIZE s; s.cx = size; s.cy = size;
    // SIIGBF_ICONONLY (0x4) | SIIGBF_BIGGERSIZEOK (0x1)
    if (f.GetImage(s, 0x5, out hbm) != 0 || hbm == IntPtr.Zero) { Marshal.ReleaseComObject(f); return false; }
    try {
      BITMAP bm;
      if (GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), out bm) == 0 || bm.bmBits == IntPtr.Zero || bm.bmBitsPixel != 32) return false;
      int w = bm.bmWidth, h = Math.Abs(bm.bmHeight), stride = bm.bmWidthBytes;
      byte[] px = new byte[stride * h];
      Marshal.Copy(bm.bmBits, px, 0, px.Length);
      bool hasAlpha = false;
      for (int i = 3; i < px.Length; i += 4) { if (px[i] != 0) { hasAlpha = true; break; } }
      if (!hasAlpha) { for (int i = 3; i < px.Length; i += 4) px[i] = 255; }
      using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb)) {
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        try {
          // DIB sections are bottom-up when bmHeight > 0.
          for (int y = 0; y < h; y++) {
            int src = (bm.bmHeight > 0 ? (h - 1 - y) : y) * stride;
            Marshal.Copy(px, src, IntPtr.Add(d.Scan0, y * d.Stride), Math.Min(stride, d.Stride));
          }
        } finally { bmp.UnlockBits(d); }
        bmp.Save(outFile, ImageFormat.Png);
      }
      return true;
    } catch { return false; }
    finally { DeleteObject(hbm); Marshal.ReleaseComObject(f); }
  }
}
'@

function Get-IconFile([string]$parsingName) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $hash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($parsingName.ToLowerInvariant() + "|$Size")) | ForEach-Object { $_.ToString('x2') })
  $file = Join-Path $CacheDir "$hash.png"
  if (Test-Path -LiteralPath $file) { return $file }
  if ([OrelleIcons]::Save($parsingName, $file, $Size)) { return $file }
  return $null
}

if ($Mode -eq 'apps') {
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.NameSpace('shell:AppsFolder')
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($item in $folder.Items()) {
    $appId = $item.Path
    if (-not $appId) { continue }
    $target = $null
    try { $target = $item.ExtendedProperty('System.Link.TargetParsingPath') } catch {}
    $icon = $null
    if (-not $NoIcons) { try { $icon = Get-IconFile ("shell:AppsFolder\" + $appId) } catch {} }
    $out.Add([ordered]@{ name = $item.Name; appId = $appId; target = $target; icon = $icon })
  }
  ConvertTo-Json -InputObject $out.ToArray() -Compress -Depth 3
}
else {
  $paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $result = [ordered]@{}
  foreach ($p in $paths) {
    try { $result[$p] = Get-IconFile $p } catch { $result[$p] = $null }
  }
  ConvertTo-Json -InputObject $result -Compress
}
