param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "services-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "services-counts.json"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de Servicios - $timestamp")
$lines.Add("")

$thirdParty = [System.Collections.Generic.List[PSCustomObject]]::new()
$system = [System.Collections.Generic.List[PSCustomObject]]::new()

try {
    $svcs = Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' }
    foreach ($s in $svcs) {
        $path = ([string]$s.PathName).ToLower()
        $isMs = $path -match '\\windows\\' -or $path -match '\\system32\\' -or $path -match '\\winsxs\\' -or $path -eq ''
        $entry = [PSCustomObject]@{ Name = $s.Name; DisplayName = $s.DisplayName; State = $s.State; PID = $s.ProcessId; MB = 0 }
        if ($isMs) { $system.Add($entry) } else { $thirdParty.Add($entry) }
    }

    $procs = Get-Process -ErrorAction SilentlyContinue
    $pidMem = @{}
    foreach ($p in $procs) {
        $mb = [math]::Round($p.WorkingSet64 / 1MB, 0)
        $pidMem[$p.Id] = $mb
    }

    foreach ($e in $thirdParty) { if ($e.PID -gt 0 -and $pidMem.ContainsKey($e.PID)) { $e.MB = $pidMem[$e.PID] } }
    foreach ($e in $system) { if ($e.PID -gt 0 -and $pidMem.ContainsKey($e.PID)) { $e.MB = $pidMem[$e.PID] } }

    $thirdParty = $thirdParty | Sort-Object -Property @{e={$_.State -eq 'Running'}}, MB -Descending
} catch {
    $lines.Add("Error al obtener servicios: $_")
}

$total3rdMem = ($thirdParty | Where-Object State -eq 'Running' | Measure-Object MB -Sum).Sum
$running3rd = @($thirdParty | Where-Object State -eq 'Running')

$lines.Add("## Servicios de Terceros (Auto) — $($thirdParty.Count)")
$lines.Add("")
if ($thirdParty.Count -gt 0) {
    $lines.Add('```')
    for ($i = 0; $i -lt $thirdParty.Count; $i++) {
        $s = $thirdParty[$i]
        $state = if ($s.State -eq 'Running') { "$($s.MB) MB" } else { 'Detenido' }
        $lines.Add("[$($i + 1)] $($s.Name) — $($s.DisplayName) — $state")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay servicios de terceros con inicio automatico.")
}
$lines.Add("")

$runningSys = @($system | Where-Object State -eq 'Running')
$lines.Add("## Servicios del Sistema (Auto) — $($system.Count)")
$lines.Add("")
if ($system.Count -gt 0) {
    $lines.Add('```')
    foreach ($s in $system) {
        $state = if ($s.State -eq 'Running') { "$($s.MB) MB" } else { 'Detenido' }
        $lines.Add("$($s.Name) — $($s.DisplayName) — $state")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay servicios del sistema con inicio automatico.")
}
$lines.Add("")

$lines.Add("## Resumen")
$lines.Add("")
$lines.Add("- Servicios de terceros (Auto): $($thirdParty.Count) ($($running3rd.Count) ejecutandose, ~$total3rdMem MB)")
$lines.Add("- Servicios del sistema (Auto): $($system.Count) ($($runningSys.Count) ejecutandose)")
$lines.Add("")

$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{ 
    date                = $timestamp
    reportPath          = $reportPath
    third_party_total   = $thirdParty.Count
    third_party_running = $running3rd.Count
    third_party_memory_mb = [math]::Round($total3rdMem, 0)
    system_total        = $system.Count
    system_running      = $runningSys.Count
    error               = $false
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
