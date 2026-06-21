<#
.SYNOPSIS
    Scans memory usage (physical RAM, process list with consumption) and writes
    a Markdown report + sidecar JSON with counts. Does NOT modify anything.

.PARAMETER ReportDir
    Directory where reports are saved. Defaults to ./reports next to this script.
#>

param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

$commonPath = Join-Path $PSScriptRoot "Common.psm1"
if (Test-Path $commonPath) { Import-Module $commonPath -Force }

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "ram-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "ram-counts.json"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de uso de RAM - $timestamp")
$lines.Add("")

# ──────────────────────────────────────────────────────
# Physical memory
# ──────────────────────────────────────────────────────
$ramError = $false
$totalMB = 0
$freeMB = 0
$usedMB = 0
$usagePct = 0

try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $totalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
    $freeMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
    $usedMB = $totalMB - $freeMB
    if ($totalMB -gt 0) { $usagePct = [math]::Round(($usedMB / $totalMB) * 100, 1) }
} catch {
    $ramError = $true
}

$lines.Add("## Resumen de memoria")
$lines.Add("")
if (-not $ramError) {
    $lines.Add("- RAM total: $totalMB MB ($([math]::Round($totalMB / 1024, 1)) GB)")
    $lines.Add("- RAM en uso: $usedMB MB ($([math]::Round($usedMB / 1024, 1)) GB)")
    $lines.Add("- RAM libre: $freeMB MB ($([math]::Round($freeMB / 1024, 1)) GB)")
    $lines.Add("- Uso: $usagePct%")
} else {
    $lines.Add("- Error al consultar memoria del sistema.")
}
$lines.Add("")

# ──────────────────────────────────────────────────────
# Process list
# ──────────────────────────────────────────────────────
$procError = $false
$processes = [System.Collections.Generic.List[PSCustomObject]]::new()

$protectedPids = Get-ProtectedPids

try {
    $procs = Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending
    foreach ($p in $procs) {
        $mb = [math]::Round($p.WorkingSet64 / 1MB, 0)
        if ($mb -le 0) { continue }
        $name = "$($p.ProcessName).exe"
        $hasWindow = -not [string]::IsNullOrWhiteSpace($p.MainWindowTitle)
        $tier = if ($protectedPids.Contains($p.Id)) { 'critical' } else { Get-ProcessTier -Name $name -HasWindow $hasWindow }
        $desc = Get-ProcessDescription -Name $name
        $processes.Add([PSCustomObject]@{
            Name      = $name
            PID       = $p.Id
            MB        = $mb
            Tier      = $tier
            Desc      = $desc
            HasWindow = $hasWindow
        })
    }
} catch {
    $procError = $true
}

$cleanMode = if ($env:CLEAN_MODE -eq 'deep') { 'deep' } else { 'soft' }
$threshold = if ($cleanMode -eq 'deep') { 10 } else { 50 }

$knownProcs = $processes | Where-Object { $_.Tier -eq 'safe_known' }
$unknownProcs = $processes | Where-Object { $_.Tier -eq 'unknown' }
$riskyProcs = $processes | Where-Object { $_.Tier -eq 'risky' }
$criticalProcs = $processes | Where-Object { $_.Tier -eq 'critical' }
$riskyCandidates = $riskyProcs | Where-Object { $_.MB -ge $threshold } | Select-Object -First 20
$topCandidates = $knownProcs | Where-Object { $_.MB -ge $threshold } | Select-Object -First 20
$deepUnknownPids = @{}
if ($cleanMode -eq 'deep') {
    $deepUnknown = $unknownProcs | Where-Object { -not $_.HasWindow -and $_.MB -ge $threshold } | Sort-Object MB -Descending | Select-Object -First 10
    $topCandidates = @($topCandidates) + @($deepUnknown)
    foreach ($p in $deepUnknown) { $deepUnknownPids[$p.PID] = $true }
}
# Excluye lo ya incluido automaticamente por modo profundo, para no listarlo
# (ni poder seleccionarlo) por duplicado en la lista de seleccion manual.
$unknownCandidates = $unknownProcs | Where-Object { $_.MB -ge $threshold -and -not $deepUnknownPids.ContainsKey($_.PID) } | Select-Object -First 20

$lines.Add("## Procesos identificados (mayor consumo)")
$lines.Add("")
if ($topCandidates.Count -gt 0) {
    $lines.Add('```')
    foreach ($p in $topCandidates) {
        $descSuffix = if ($p.Desc) { " — $($p.Desc)" } else { '' }
        $label = if ($p.Tier -eq 'unknown') { '(incluido por modo profundo)' } else { '(seguro de liberar)' }
        $lines.Add("[$($p.PID)] $($p.Name)$descSuffix  $($p.MB) MB  $label")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay procesos candidatos con consumo >= $threshold MB.")
}
$lines.Add("")

$lines.Add("## Procesos no recomendados (revisar antes de cerrar)")
$lines.Add("")
$lines.Add("Editores, navegadores, sincronizacion, chat y similares: cerrarlos sin guardar pierde tu trabajo o sesion.")
$lines.Add("")
if ($riskyCandidates.Count -gt 0) {
    $lines.Add('```')
    foreach ($p in $riskyCandidates) {
        $lines.Add("[$($p.PID)] $($p.Name)  $($p.MB) MB  (no recomendado)")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay procesos de esta categoria con consumo significativo.")
}
$lines.Add("")

$lines.Add("## Procesos no identificados (revisar antes de liberar)")
$lines.Add("")
$lines.Add("Procesos en segundo plano sin descripcion conocida. No se incluyen en Seleccionar todos.")
$lines.Add("")
if ($unknownCandidates.Count -gt 0) {
    $lines.Add('```')
    foreach ($p in $unknownCandidates) {
        $lines.Add("[$($p.PID)] $($p.Name)  $($p.MB) MB  (no identificado)")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay procesos no identificados con consumo significativo.")
}
$lines.Add("")

$lines.Add("## Todos los procesos ($($processes.Count))")
$lines.Add("")
$lines.Add("- Identificados (seguros de liberar): $($knownProcs.Count)")
$lines.Add("- No identificados (revisar antes): $($unknownProcs.Count)")
$lines.Add("- No recomendados (editores/navegadores/sync/chat): $($riskyProcs.Count)")
$lines.Add("- Procesos criticos (no tocar): $($criticalProcs.Count)")
$lines.Add("")

# ──────────────────────────────────────────────────────
# Write files
# ──────────────────────────────────────────────────────
$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

$top5 = $topCandidates | Select-Object -First 5 | ForEach-Object {
    @{ name = $_.Name; pid = $_.PID; mb = $_.MB; desc = $_.Desc }
}

@{ 
    date              = $timestamp
    reportPath        = $reportPath
    total_mb          = $totalMB
    used_mb           = $usedMB
    free_mb           = $freeMB
    usage_percent     = $usagePct
    total_processes   = $processes.Count
    known_processes   = $knownProcs.Count
    unknown_processes = $unknownProcs.Count
    risky_processes   = $riskyProcs.Count
    critical_processes = $criticalProcs.Count
    top_processes     = $top5
    error             = ($ramError -or $procError)
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
Write-Output "Conteos generados en: $countsPath"
