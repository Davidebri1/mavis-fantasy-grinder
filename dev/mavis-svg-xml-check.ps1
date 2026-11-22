$ErrorActionPreference = "Continue"
$dir = "C:\Users\D\mavis-outlier\docs\shots"
Get-ChildItem $dir -Filter "mavis-eval-*.svg" | Sort-Object Name | ForEach-Object {
  $path = $_.FullName
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $bom = if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { "BOM" } else { "noBOM" }
  $t = [System.Text.Encoding]::UTF8.GetString($bytes)
  $doc = New-Object System.Xml.XmlDocument
  $ok = $true; $msg = ""; $pos = -1
  try { $doc.LoadXml($t) } catch {
    $ok = $false
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
    if ($msg -match "position (\d+)") { $pos = [int]$Matches[1] }
  }
  $ctx = ""
  if ($pos -ge 0) {
    $s = [Math]::Max(0, $pos - 90)
    $len = [Math]::Min(220, $t.Length - $s)
    $ctx = $t.Substring($s, $len)
  }
  Write-Output ("=== " + $_.Name + " | xml=" + $ok + " | " + $bom + " | bytes=" + $bytes.Length + " | pos=" + $pos)
  if ($msg) { Write-Output ("    ERR: " + $msg) }
  if ($ctx) { Write-Output ("    CTX: " + $ctx) }
}