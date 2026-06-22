param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "power-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "power-counts.json"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de Energia - $timestamp")
$lines.Add("")

$activeGuid = ''; $activeName = ''
$activeOut = powercfg /getactivescheme 2>&1 | Out-String
if ($activeOut -match '([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12})') {
    $activeGuid = $Matches[1]
    if ($activeOut -match '\((.+?)\)') { $activeName = $Matches[1] }
}

$plans = [System.Collections.Generic.List[PSCustomObject]]::new()
$listOut = powercfg /list 2>&1 | Out-String
foreach ($line in ($listOut -split "`r`n")) {
    if ($line -match '([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}).*\((.+?)\)') {
        $plans.Add([PSCustomObject]@{ Guid = $Matches[1]; Name = $Matches[2]; Active = $line -match '\*' })
    }
}

$lines.Add("## Plan de energia activo"); $lines.Add("")
$lines.Add("- $activeName ($activeGuid)"); $lines.Add("")

$lines.Add("## Planes disponibles"); $lines.Add("")
if ($plans.Count -gt 0) {
    $lines.Add('```')
    for ($i = 0; $i -lt $plans.Count; $i++) {
        $p = $plans[$i]
        $marker = if ($p.Active) { ' (ACTIVO)' } else { '' }
        $lines.Add("[$($i+1)] $($p.Name) -- GUID: $($p.Guid)$marker")
    }
    $lines.Add('```')
}
$lines.Add("")

$batteryPct = $null; $batteryStatus = ''; $runtimeMin = $null; $powerWatts = $null
try {
    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($bat) {
        $batteryPct = $bat.EstimatedChargeRemaining
        $runtimeSec = $bat.EstimatedRunTime
        if ($runtimeSec -eq 4294967295 -or $runtimeSec -le 0) { $runtimeMin = $null }
        else { $runtimeMin = [math]::Round($runtimeSec / 60, 0) }
        switch ($bat.BatteryStatus) {
            1 { $batteryStatus = 'Descargando' }
            2 { $batteryStatus = 'En CA' }
            3 { $batteryStatus = 'En CA' }
            4 { $batteryStatus = 'Bateria baja' }
            5 { $batteryStatus = 'Bateria critica' }
            6 { $batteryStatus = 'Cargando' }
            7 { $batteryStatus = 'Cargando' }
            8 { $batteryStatus = 'Cargando' }
            9 { $batteryStatus = 'Cargando' }
            10 { $batteryStatus = 'Cargando' }
            11 { $batteryStatus = 'Parcialmente cargada' }
            default { $batteryStatus = 'Conectado' }
        }
        if ($bat.BatteryStatus -eq 1 -and $runtimeMin -gt 0 -and $bat.FullChargeCapacity -gt 0 -and $batteryPct -gt 0) {
            $currentMWh = $bat.FullChargeCapacity * ($batteryPct / 100)
            $powerWatts = [math]::Round($currentMWh / 1000 / ($runtimeMin / 60))
        }
    }
} catch {}

$hasBattery = $null -ne $batteryPct
if ($hasBattery) {
    $lines.Add("## Bateria"); $lines.Add("")
    $lines.Add("- Estado: $batteryStatus")
    $lines.Add("- Carga: $batteryPct%")
    if ($runtimeMin -and $runtimeMin -gt 0) {
        $h = [math]::Floor($runtimeMin / 60); $m = [math]::Round($runtimeMin % 60)
        $fmt = if ($h -gt 0) { "${h}h ${m}m" } else { "${m}m" }
    } else { $fmt = 'N/A' }
    $lines.Add("- Tiempo restante: $fmt")
    if ($powerWatts) { $lines.Add("- Consumo estimado: $powerWatts W") }
    $lines.Add("")
}

$lines.Add("## Resumen"); $lines.Add("")
$lines.Add("- Plan activo: $activeName")
$lines.Add("- Bateria presente: $(if ($hasBattery) { 'Si' } else { 'No' })")
if ($powerWatts) { $lines.Add("- Consumo: $powerWatts W") }
$lines.Add("")

$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{
    date            = $timestamp
    reportPath      = $reportPath
    active_plan     = $activeName
    active_guid     = $activeGuid
    plans_count     = $plans.Count
    battery_present = $hasBattery
    battery_pct     = $batteryPct
    battery_status  = $batteryStatus
    runtime_min     = $runtimeMin
    power_watts     = $powerWatts
    error           = $false
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
