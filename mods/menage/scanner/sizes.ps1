# menage mod: folder sizes on Windows, read-only. Folders on stdin, one per line; one line out per folder:
#   <bytes>\t<files>\t<newest write time, ms since 1970>\t<truncated 0|1>\t<folder>
# .NET's file enumeration returns sizes from the directory listing itself (no file is opened), much faster than one
# stat per file. Junctions and symbolic links are skipped. Needs PowerShell 7 (pwsh, .NET EnumerationOptions).
param([long]$MaxEntries = 400000)
$opt = [System.IO.EnumerationOptions]::new()
$opt.RecurseSubdirectories = $true
$opt.AttributesToSkip = [System.IO.FileAttributes]::ReparsePoint
$opt.IgnoreInaccessible = $true
$epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc).Ticks
$in = [Console]::In
while ($null -ne ($d = $in.ReadLine())) {
  if (-not $d) { continue }
  $b = [long]0; $n = [long]0; $m = [long]0; $cut = 0
  try {
    foreach ($f in [System.IO.DirectoryInfo]::new($d).EnumerateFiles('*', $opt)) {
      $b += $f.Length; $n++
      $t = $f.LastWriteTimeUtc.Ticks
      if ($t -gt $m) { $m = $t }
      if ($n -ge $MaxEntries) { $cut = 1; break }
    }
  } catch {}
  $ms = if ($m -gt 0) { [long](($m - $epoch) / 10000) } else { 0 }
  "$b`t$n`t$ms`t$cut`t$d"
}
