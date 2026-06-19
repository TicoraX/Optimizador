<#
.SYNOPSIS
    Weekly entry point: scans startup configuration and shows a popup summary.
    If the user accepts, launches Optimize-Startup.ps1 in an interactive window.
#>

$scriptDir = $PSScriptRoot
& (Join-Path $scriptDir "Scan-Startup.ps1")

$today = Get-Date -Format "yyyy-MM-dd"
$reportsDir = Join-Path $scriptDir "reports"
$reportPath = Join-Path $reportsDir "startup-report-$today.md"
$countsPath = Join-Path $reportsDir "startup-counts.json"

if (-not (Test-Path $countsPath)) {
    exit
}

$counts = Get-Content $countsPath -Raw | ConvertFrom-Json

function Format-PopupLine {
    param([string]$Label, $Data)
    if ($Data.error) { return "$Label`: error" }
    if ($Data.PSObject.Properties.Name -contains 'enabled') {
        return "$Label`: $($Data.count) ($($Data.enabled) habilitadas)"
    }
    return "$Label`: $($Data.count)"
}

$bootLine = if ($counts.boot_performance.error) {
    "Boot: error"
} else {
    "Boot: $($counts.boot_performance.boot_time_ms) ms (tendencia: $($counts.boot_performance.trend))"
}

$lines = @(
    (Format-PopupLine "Programas de inicio" $counts.startup_programs)
    $bootLine
    (Format-PopupLine "Servicios auto-start" $counts.auto_services)
    (Format-PopupLine "Tareas al inicio/logon" $counts.logon_tasks)
) -join "`n"

$summary = "Reporte semanal de inicio ($today)`n`n" +
           "$lines`n`n" +
           "Reporte completo: $reportPath`n`n" +
           "Deseas revisar y optimizar ahora?"

Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    "Startup Optimizer - Reporte semanal",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
)

if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    Start-Process $shell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $scriptDir 'Optimize-Startup.ps1')`""
}
