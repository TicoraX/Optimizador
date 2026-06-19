<#
.SYNOPSIS
    Weekly entry point: scans reclaimable disk space and shows a popup summary.
    If the user accepts, launches Clean-Disk.ps1 in an interactive window.
#>

$scriptDir = $PSScriptRoot
& (Join-Path $scriptDir "Scan-Cleanup.ps1")

$today = Get-Date -Format "yyyy-MM-dd"
$reportsDir = Join-Path $scriptDir "reports"
$reportPath = Join-Path $reportsDir "cleanup-report-$today.md"
$countsPath = Join-Path $reportsDir "cleanup-counts.json"

if (-not (Test-Path $countsPath)) {
    exit
}

$counts = Get-Content $countsPath -Raw | ConvertFrom-Json

function Format-PopupLine {
    param([string]$Label, $Data)
    if ($Data.error) { return "$Label`: error" }
    return "$Label`: $($Data.total_mb) MB"
}

$lines = @(
    (Format-PopupLine "Temporales de Windows" $counts.temp)
    (Format-PopupLine "Cache de navegadores" $counts.browser_cache)
    (Format-PopupLine "Descargas viejas (>$($counts.downloads.count) archivos)" $counts.downloads)
    (Format-PopupLine "Papelera ($($counts.recycle_bin.count) elementos)" $counts.recycle_bin)
) -join "`n"

$summary = "Reporte semanal de limpieza de disco ($today)`n`n" +
           "$lines`n`n" +
           "Reporte completo: $reportPath`n`n" +
           "Deseas revisar y limpiar ahora?"

Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    "Disk Cleanup - Reporte semanal",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
)

if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    Start-Process $shell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $scriptDir 'Clean-Disk.ps1')`""
}
