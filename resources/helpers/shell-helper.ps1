<#
  Orelle shell helper — read-only bridge to the Windows Shell.

  Modes:
    apps   Enumerates shell:AppsFolder (desktop + Store apps, same list as the Start menu)
           and writes a JSON array to stdout. Icons are extracted into -CacheDir.
    icons  Reads a JSON array of filesystem paths / shell parsing names from stdin and
           extracts their icons into -CacheDir. Writes { path: iconFile } JSON to stdout.
    taskbar  Reads the Windows taskbar as the user sees it: its buttons in visual order through
           UI Automation (AppUserModelID + accessible name), plus the pinned shortcuts in
           %APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned. Read-only.

  This script never writes outside -CacheDir and never modifies the system.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('apps', 'icons', 'taskbar', 'desktopicons')][string]$Mode,
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
using System.Drawing.Drawing2D;
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
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SHGetFileInfo(string path, uint attributes, ref SHFILEINFO info, uint cbFileInfo, uint flags);

  // Returns true when an icon was written to outFile.
  public static bool Save(string parsingName, string outFile, int size) {
    // Prefer the native HICON path: unlike the shell image factory it carries
    // the Windows icon mask correctly for legacy EXE icons.
    if (SaveNativeIcon(parsingName, outFile, size)) return true;
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
      // Some Windows shell providers return a useful colour bitmap but leave
      // every alpha byte at zero. Do not turn that transparent canvas opaque:
      // ask the Shell for the native HICON instead, which preserves its mask.
      if (!hasAlpha && SaveNativeIcon(parsingName, outFile, size)) return true;
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
        SaveFramed(bmp, outFile, size);
      }
      return true;
    } catch { return false; }
    finally { DeleteObject(hbm); Marshal.ReleaseComObject(f); }
  }

  static bool SaveNativeIcon(string parsingName, string outFile, int size) {
    SHFILEINFO info = new SHFILEINFO();
    if (SHGetFileInfo(parsingName, 0, ref info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x100) == IntPtr.Zero || info.hIcon == IntPtr.Zero) return false;
    try {
      using (Icon icon = Icon.FromHandle(info.hIcon)) using (Bitmap bmp = icon.ToBitmap()) SaveFramed(bmp, outFile, size);
      return true;
    } catch { return false; }
    finally { DestroyIcon(info.hIcon); }
  }

  static void SaveFramed(Bitmap bmp, string outFile, int size) {
    int w = bmp.Width, h = bmp.Height;
    Rectangle bounds = FindAlphaBounds(bmp);
    // Some legacy EXE icons are returned as fully opaque bitmaps with a
    // solid square matte around the actual artwork. Alpha-only trimming sees
    // the whole square in that case, so remove a uniform opaque edge first.
    if (bounds.Width >= w - 1 && bounds.Height >= h - 1) {
      Rectangle matte = FindOpaqueMatteBounds(bmp);
      if (matte.Width > 0 && matte.Height > 0) bounds = matte;
    }
    if (bounds.Width <= 0 || bounds.Height <= 0) bounds = new Rectangle(0, 0, w, h);
    int side = Math.Max(bounds.Width, bounds.Height);
    int pad = Math.Max(2, (int)Math.Ceiling(side * 0.08));
    int left = Math.Max(0, bounds.X - pad), top = Math.Max(0, bounds.Y - pad);
    int right = Math.Min(w, bounds.Right + pad), bottom = Math.Min(h, bounds.Bottom + pad);
    side = Math.Max(right - left, bottom - top);
    left = Math.Max(0, Math.Min(left, w - side));
    top = Math.Max(0, Math.Min(top, h - side));
    using (var framed = new Bitmap(size, size, PixelFormat.Format32bppPArgb))
    using (var g = Graphics.FromImage(framed)) {
      g.Clear(Color.Transparent);
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.DrawImage(bmp, new Rectangle(0, 0, size, size), new Rectangle(left, top, side, side), GraphicsUnit.Pixel);
      framed.Save(outFile, ImageFormat.Png);
    }
  }

  static Rectangle FindAlphaBounds(Bitmap bmp) {
    int left = bmp.Width, top = bmp.Height, right = -1, bottom = -1;
    for (int y = 0; y < bmp.Height; y++) for (int x = 0; x < bmp.Width; x++) {
      if (bmp.GetPixel(x, y).A < 8) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
    return right < left ? Rectangle.Empty : Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
  }

  static Rectangle FindOpaqueMatteBounds(Bitmap bmp) {
    Color a = bmp.GetPixel(0, 0);
    Color b = bmp.GetPixel(bmp.Width - 1, 0);
    Color c = bmp.GetPixel(0, bmp.Height - 1);
    Color d = bmp.GetPixel(bmp.Width - 1, bmp.Height - 1);
    if (!Near(a, b, 18) || !Near(a, c, 18) || !Near(a, d, 18) || a.A < 240) return Rectangle.Empty;

    int left = bmp.Width, top = bmp.Height, right = -1, bottom = -1;
    for (int y = 0; y < bmp.Height; y++) for (int x = 0; x < bmp.Width; x++) {
      Color p = bmp.GetPixel(x, y);
      if (p.A < 240 || !Near(p, a, 28)) {
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
    }
    Rectangle result = right < left ? Rectangle.Empty : Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    // Only treat it as a matte when it removes a meaningful border. This
    // avoids changing ordinary full-bleed square artwork.
    return result.Width <= bmp.Width - 4 && result.Height <= bmp.Height - 4 ? result : Rectangle.Empty;
  }

  static bool Near(Color x, Color y, int tolerance) {
    return Math.Abs(x.R - y.R) <= tolerance && Math.Abs(x.G - y.G) <= tolerance && Math.Abs(x.B - y.B) <= tolerance;
  }
}
'@

function Get-IconFile([string]$parsingName) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $hash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($parsingName.ToLowerInvariant() + "|$Size|3")) | ForEach-Object { $_.ToString('x2') })
  $file = Join-Path $CacheDir "$hash.png"
  if (Test-Path -LiteralPath $file) { return $file }
  if ([OrelleIcons]::Save($parsingName, $file, $Size)) { return $file }
  return $null
}

if ($Mode -eq 'desktopicons') {
  # The desktop's list view (under Progman, or a WorkerW on some builds) and its icons' rectangles.
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $A = [System.Windows.Automation.AutomationElement]
  $listView = 0
  $icons = New-Object System.Collections.Generic.List[object]
  foreach ($cls in @('Progman', 'WorkerW')) {
    $tops = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, $cls)))
    foreach ($top in $tops) {
      $lv = $top.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'SysListView32')))
      if (-not $lv) { continue }
      $listView = $lv.Current.NativeWindowHandle
      foreach ($it in $lv.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        $r = $it.Current.BoundingRectangle
        if ($r.Width -gt 0) { $icons.Add([ordered]@{ l = [int]$r.Left; t = [int]$r.Top; r = [int]$r.Right; b = [int]$r.Bottom }) }
      }
      break
    }
    if ($listView) { break }
  }
  ConvertTo-Json -InputObject ([ordered]@{ listView = $listView; icons = $icons.ToArray() }) -Compress -Depth 3
  exit 0
}

if ($Mode -eq 'taskbar') {
  $buttons = New-Object System.Collections.Generic.List[object]
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $A = [System.Windows.Automation.AutomationElement]
    $tray = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Shell_TrayWnd')))
    if ($tray) {
      $found = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($e in $found) {
        $c = $e.Current
        if ($c.AutomationId -notlike 'Appid:*') { continue }
        $buttons.Add([ordered]@{ id = $c.AutomationId.Substring(6).Trim(); name = $c.Name; x = $c.BoundingRectangle.X; y = $c.BoundingRectangle.Y })
      }
    }
  } catch {}
  $links = New-Object System.Collections.Generic.List[object]
  $root = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned'
  if (Test-Path -LiteralPath $root) {
    $shell = New-Object -ComObject Shell.Application
    $wsh = New-Object -ComObject WScript.Shell
    foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue) {
      if ($f.FullName -notmatch '\\(TaskBar|ImplicitAppShortcuts)\\') { continue }
      $aumid = $null; $target = $null
      try { $aumid = $shell.NameSpace($f.DirectoryName).ParseName($f.Name).ExtendedProperty('System.AppUserModel.ID') } catch {}
      try { $target = $wsh.CreateShortcut($f.FullName).TargetPath } catch {}
      $links.Add([ordered]@{ file = $f.FullName; name = $f.BaseName; aumid = $aumid; target = $target })
    }
  }
  ConvertTo-Json -InputObject ([ordered]@{ buttons = $buttons.ToArray(); links = $links.ToArray() }) -Compress -Depth 3
  exit 0
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
