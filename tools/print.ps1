<#
    demo SAREES - Windows print helper
    ------------------------------------------------------------
    Called by tools/serve.js so the browser can print straight to
    the USB printer (TVS LP 46 Lite and friends) with no dialog.

        powershell -File print.ps1 -Mode list
        powershell -File print.ps1 -Mode image -Printer "TVS LP 46" -File row.png -WidthMm 100 -HeightMm 30 -Copies 5
        powershell -File print.ps1 -Mode raw   -Printer "TVS LP 46" -File job.bin

    image : goes through the Windows driver, so whatever the
            printer speaks (TSPL / ESC-POS / anything) is the
            driver's problem, not ours.
    raw   : bytes are handed to the spooler untouched, for
            printers driven with their own command language.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'raw', 'image')][string]$Mode,
  [string]$Printer = '',
  [string]$File = '',
  [double]$WidthMm = 0,
  [double]$HeightMm = 0,
  [int]$Copies = 1,
  [string]$Manifest = '',   # image mode: a run of pages, "<copies><tab><png path>" per line
  [ValidateSet(0, 90, 180, 270)][int]$Rotate = 0,
  [string]$OutFile = ''     # print to a file instead of paper - handy for testing
)

$ErrorActionPreference = 'Stop'

function Write-Result($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 4) }

try {
  switch ($Mode) {

    'list' {
      $found = @()
      foreach ($p in (Get-CimInstance -ClassName Win32_Printer)) {
        $found += [pscustomobject]@{
          name    = $p.Name
          default = [bool]$p.Default
          offline = [bool]$p.WorkOffline
          port    = $p.PortName
        }
      }
      Write-Result @{ ok = $true; printers = $found }
    }

    'raw' {
      if (-not $Printer) { throw 'No printer name was given.' }
      if (-not (Test-Path -LiteralPath $File)) { throw "Job file not found: $File" }

      Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class demoRawPrinter
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW
  {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinterW(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool StartDocPrinterW(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendFile(string printerName, string filePath, string docName)
  {
    byte[] bytes = File.ReadAllBytes(filePath);
    IntPtr hPrinter;
    if (!OpenPrinterW(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception("Cannot open printer '" + printerName + "' (" + Marshal.GetLastWin32Error() + ")");
    try
    {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = docName;
      di.pDataType = "RAW";
      if (!StartDocPrinterW(hPrinter, 1, di))
        throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      try
      {
        if (!StartPagePrinter(hPrinter))
          throw new Exception("StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
          Marshal.Copy(bytes, 0, buf, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
            throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")");
        }
        finally { Marshal.FreeCoTaskMem(buf); }
        EndPagePrinter(hPrinter);
      }
      finally { EndDocPrinter(hPrinter); }
    }
    finally { ClosePrinter(hPrinter); }
  }
}
'@
      $n = [Math]::Max(1, $Copies)
      for ($i = 0; $i -lt $n; $i++) {
        [demoRawPrinter]::SendFile($Printer, $File, 'demo SAREES')
      }
      Write-Result @{ ok = $true; printer = $Printer; copies = $n }
    }

    'image' {
      if (-not $Printer) { throw 'No printer name was given.' }

      # A whole run of stickers arrives as a manifest - one page per line,
      # "<copies><tab><png path>" - so a hundred labels are one spooled job
      # instead of a hundred.
      $script:demoPages = @()
      if ($Manifest) {
        if (-not (Test-Path -LiteralPath $Manifest)) { throw "Job list not found: $Manifest" }
        foreach ($row in (Get-Content -LiteralPath $Manifest)) {
          if (-not $row.Trim()) { continue }
          $bits = $row -split "`t", 2
          if ($bits.Count -lt 2) { continue }
          $script:demoPages += [pscustomobject]@{ Copies = [Math]::Max(1, [int]$bits[0]); Path = $bits[1] }
        }
      }
      elseif (Test-Path -LiteralPath $File) {
        $script:demoPages += [pscustomobject]@{ Copies = [Math]::Max(1, $Copies); Path = $File }
      }
      if (-not $script:demoPages.Count) { throw 'The print job had no pages in it.' }

      Add-Type -AssemblyName System.Drawing

      $doc = New-Object System.Drawing.Printing.PrintDocument
      $doc.DocumentName = 'demo SAREES'
      $doc.PrinterSettings.PrinterName = $Printer
      if (-not $doc.PrinterSettings.IsValid) { throw "Windows has no printer named '$Printer'." }

      $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
      $doc.OriginAtMargins = $false
      # Label drivers often save "landscape" as their default, which turns the
      # sticker on its side. The artwork is already the right way round.
      $doc.DefaultPageSettings.Landscape = $false
      if ($OutFile) {
        $doc.PrinterSettings.PrintToFile = $true
        $doc.PrinterSettings.PrintFileName = $OutFile
      }

      # Page sizes are in hundredths of an inch.
      if ($WidthMm -gt 0 -and $HeightMm -gt 0) {
        $w = [int][Math]::Round($WidthMm * 100.0 / 25.4)
        $h = [int][Math]::Round($HeightMm * 100.0 / 25.4)

        # A label stock the driver already knows is honoured far more
        # reliably than a custom size, so look for a match first (8/100
        # inch of slack, about 2mm).
        $match = $null
        foreach ($ps in $doc.PrinterSettings.PaperSizes) {
          if ([Math]::Abs($ps.Width - $w) -le 8 -and [Math]::Abs($ps.Height - $h) -le 8) { $match = $ps; break }
        }
        if ($match) {
          $doc.DefaultPageSettings.PaperSize = $match
        }
        else {
          $size = New-Object System.Drawing.Printing.PaperSize('demo', $w, $h)
          $size.RawKind = 256      # DMPAPER_USER - a custom size
          $doc.DefaultPageSettings.PaperSize = $size
        }
      }

      # The artwork's true size in hundredths of an inch - what it must
      # measure on the label, whatever the driver would rather do.
      $script:demoW = 0
      $script:demoH = 0
      if ($WidthMm -gt 0 -and $HeightMm -gt 0) {
        $script:demoW = [int][Math]::Round($WidthMm * 100.0 / 25.4)
        $script:demoH = [int][Math]::Round($HeightMm * 100.0 / 25.4)
      }

      $script:demoIndex = 0        # which page of the run
      $script:demoCopy = 0         # copies of it printed so far
      $script:demoImg = $null
      $script:demoTotal = 0

      $doc.add_PrintPage({
          param($sender, $e)
          $item = $script:demoPages[$script:demoIndex]
          if (-not $script:demoImg) {
            # Load through a copy so GDI+ does not keep the file locked.
            $bytes = [System.IO.File]::ReadAllBytes($item.Path)
            $script:demoImg = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))
            switch ($Rotate) {
              90 { $script:demoImg.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
              180 { $script:demoImg.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
              270 { $script:demoImg.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
            }
          }
          $img = $script:demoImg
          $page = $e.PageBounds

          # 1:1, not fit-to-page. The artwork is drawn at its true physical
          # size, so a 100 x 30 mm row lands as 100 x 30 mm on the roll and a
          # sticker's content cannot spill into the one beside it.
          if ($script:demoW -gt 0 -and $script:demoH -gt 0) {
            $dw = $script:demoW
            $dh = $script:demoH
          }
          else {
            # No size was given: fall back to the page, shape kept.
            $scale = [Math]::Min($page.Width / $img.Width, $page.Height / $img.Height)
            $dw = [int][Math]::Floor($img.Width * $scale)
            $dh = [int][Math]::Floor($img.Height * $scale)
          }

          # The drawing origin sits at the corner of the *printable* area, so
          # the driver's own unprintable border would push the artwork in.
          # Cancelling it puts 0,0 back at the physical corner of the label.
          $ox = [int][Math]::Round($e.PageSettings.HardMarginX)
          $oy = [int][Math]::Round($e.PageSettings.HardMarginY)
          $e.Graphics.TranslateTransform(- $ox, - $oy)

          $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
          $e.Graphics.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)))
          $script:demoBounds = "page $($page.Width)x$($page.Height), art ${dw}x${dh}, hard margin ${ox}x${oy} (1/100 in)"

          $script:demoCopy++
          $script:demoTotal++
          if ($script:demoCopy -ge $item.Copies) {
            $script:demoImg.Dispose(); $script:demoImg = $null
            $script:demoIndex++; $script:demoCopy = 0
          }
          $e.HasMorePages = ($script:demoIndex -lt $script:demoPages.Count)
        })

      $doc.Print()
      $paper = $doc.DefaultPageSettings.PaperSize
      if ($script:demoImg) { $script:demoImg.Dispose() }
      $doc.Dispose()
      Write-Result @{
        ok      = $true
        printer = $Printer
        copies  = $script:demoTotal
        paper   = "$($paper.PaperName) $([Math]::Round($paper.Width * 0.254, 1))x$([Math]::Round($paper.Height * 0.254, 1))mm"
        page    = $script:demoBounds
        rotate  = $Rotate
      }
    }
  }
}
catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
