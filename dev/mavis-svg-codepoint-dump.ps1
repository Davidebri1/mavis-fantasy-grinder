$dir = "C:\Users\D\mavis-outlier\docs\shots"
function Dump($file, $from, $to) {
  $t = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($file))
  Write-Output ("=== " + (Split-Path $file -Leaf) + " (len " + $t.Length + ")")
  for ($i = $from; $i -lt [Math]::Min($to, $t.Length); $i++) {
    $c = $t[$i]
    $code = [int][char]$c
    $flag = if ($code -gt 126 -or ($code -lt 32 -and $code -ne 9 -and $code -ne 10 -and $code -ne 13)) { "  <<< NON-ASCII" } else { "" }
    if ($code -gt 126 -or $flag) { Write-Output ("  idx=" + $i + " code=" + $code + " U+" + ("{0:X4}" -f $code) + " char=[" + $c + "]" + $flag) }
  }
}
$bad = Join-Path $dir "mavis-eval-direction.svg"
$good = Join-Path $dir "mavis-eval-agreement.svg"
Write-Output "--- BAD (direction): chars 225..275 ---"
Dump $bad 225 275
Write-Output "--- BAD: first 3 non-ascii in whole file ---"
$t = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($bad))
$n = 0
for ($i = 0; $i -lt $t.Length -and $n -lt 3; $i++) { $code = [int][char]$t[$i]; if ($code -gt 126) { $n++; Write-Output ("  idx=" + $i + " code=" + $code + " U+" + ("{0:X4}" -f $code) + " ctx=[" + $t.Substring([Math]::Max(0,$i-40), 80) + "]") } }
Write-Output "--- GOOD (agreement): first 300 chars ---"
$g = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($good))
Write-Output $g.Substring(0, 300)
Write-Output "--- GOOD: does it contain stroke-width? ---"
Write-Output ([regex]::Matches($g, "stroke-width").Count)
Write-Output "--- BAD: does it contain stroke-width? ---"
Write-Output ([regex]::Matches($t, "stroke-width").Count)