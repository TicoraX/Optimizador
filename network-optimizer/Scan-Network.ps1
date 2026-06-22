param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "network-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "network-counts.json"

$reportLines = [System.Collections.Generic.List[string]]::new()
$reportLines.Add("# Reporte de Red - $timestamp")
$reportLines.Add("")

$dnsEntries = 0
try {
    $dnsOut = ipconfig /displaydns 2>&1 | Out-String
    $dnsEntries = @($dnsOut -split "`r`n" | Where-Object { $_ -match '^\s+(?:Nombre|Name)\s+\.' }).Count
} catch {}

$avgPingMs = $null
$packetLoss = 0
try {
    $pingOut = ping -n 4 8.8.8.8 2>&1 | Out-String
    if ($pingOut -match '(?:Promedio|Average|Moyenne|Durchschnitt|M.dia)\s*=\s*(\d+)') {
        $avgPingMs = [int]$Matches[1]
    }
    if ($pingOut -match '(\d+)%\s*(?:perdido|loss|verlust|perte|perda)') {
        $packetLoss = [int]$Matches[1]
    }
} catch {}

$activeAdapters = 0
$disconnectedAdapters = 0
try {
    $ipOut = ipconfig 2>&1 | Out-String
    $ipLines = $ipOut -split "`r`n"
    $currentDisconnected = $false
    $inAdapter = $false
    for ($i = 0; $i -lt $ipLines.Length; $i++) {
        $line = $ipLines[$i]
        $isHeader = $line -match '^[A-Za-z]'
        if ($isHeader) {
            if ($inAdapter) { if ($currentDisconnected) { $disconnectedAdapters++ } else { $activeAdapters++ } }
            $inAdapter = $true
            $currentDisconnected = $false
        } elseif ($inAdapter -and ($line -match 'desconectado|disconnected')) {
            $currentDisconnected = $true
        }
    }
    if ($inAdapter) { if ($currentDisconnected) { $disconnectedAdapters++ } else { $activeAdapters++ } }
} catch {}

$fmtMs = if ($null -ne $avgPingMs) { "$avgPingMs ms" } else { 'N/A' }

$reportLines.Add("## Resumen de conectividad")
$reportLines.Add("")
$reportLines.Add("- Cache DNS: $dnsEntries entradas")
$reportLines.Add("- Ping a 8.8.8.8: $fmtMs")
$reportLines.Add("- Perdida de paquetes: $packetLoss%")
$reportLines.Add("")
$reportLines.Add("## Adaptadores de red")
$reportLines.Add("")
$reportLines.Add("- Activos: $activeAdapters")
$reportLines.Add("- Desconectados: $disconnectedAdapters")
$reportLines.Add("- Total: $($activeAdapters + $disconnectedAdapters)")
$reportLines.Add("")

$reportLines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{ 
    date                  = $timestamp
    reportPath            = $reportPath
    dns_cache_entries     = $dnsEntries
    avg_ping_ms           = $avgPingMs
    packet_loss           = $packetLoss
    active_adapters       = $activeAdapters
    disconnected_adapters = $disconnectedAdapters
    error                 = $false
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
