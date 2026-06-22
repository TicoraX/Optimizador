param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "apps-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "apps-counts.json"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de Aplicaciones - $timestamp")
$lines.Add("")

$apps = @()
try {
    $wingetOut = winget list --accept-source-agreements 2>&1 | Out-String
    $started = $false
    foreach ($line in ($wingetOut -split "`r`n")) {
        if (-not $started) { if ($line -match '^---') { $started = $true }; continue }
        if (-not $line.Trim()) { continue }
        $parts = @($line -split '\s{2,}' | ForEach-Object { $_.Trim() })
        if ($parts.Count -ge 3) {
            $apps += [PSCustomObject]@{
                Name    = $parts[0]
                Id      = $parts[1]
                Version = if ($parts[2]) { $parts[2] } else { '' }
                Source  = if ($parts.Count -ge 4) { $parts[$parts.Count - 1] } else { '' }
            }
        }
    }
} catch {}

$lines.Add("## Aplicaciones Instaladas ($($apps.Count))")
$lines.Add("")
if ($apps.Count -gt 0) {
    $lines.Add('```')
    for ($i = 0; $i -lt $apps.Count; $i++) {
        $a = $apps[$i]
        $lines.Add("[$($i+1)] $($a.Name) -- $($a.Id) -- $($a.Version) -- $($a.Source)")
    }
    $lines.Add('```')
} else {
    $lines.Add("No se pudieron obtener aplicaciones via winget.")
}
$lines.Add("")

$lines.Add("## Resumen")
$lines.Add("")
$lines.Add("- Total: $($apps.Count)")
$lines.Add("")

$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{ 
    date       = $timestamp
    reportPath = $reportPath
    apps_count = $apps.Count
    error      = $false
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
