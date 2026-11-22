$dir = "C:\Users\D\mavis-outlier\docs\shots"
Get-ChildItem $dir -Filter "mavis-eval-*.svg" | Sort-Object Name | ForEach-Object {
  $path = $_.FullName
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $reader = New-Object System.Xml.XmlTextReader($path, $settings)
  $reader.ConformanceLevel = [System.Xml.ConformanceLevel]::Document
  $last = ""; $lastType = ""; $n = 0; $err = ""
  try {
    while ($reader.Read()) { $n++; $last = $reader.Name; $lastType = $reader.NodeType }
  } catch {
    $err = $_.Exception.Message
    if ($_.Exception.InnerException) { $err = $_.Exception.InnerException.Message }
  }
  $reader.Close()
  Write-Output ("=== " + $_.Name + " | nodes=" + $n + " | lastGood=" + $lastType + ":" + $last + " | err=" + $err)
}