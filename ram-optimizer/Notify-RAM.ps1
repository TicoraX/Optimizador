<#
.SYNOPSIS
    Weekly entry point: scans RAM usage and shows a popup summary.
    If the user accepts, launches Free-RAM.ps1 in an interactive window.
#>

$scriptDir = $PSScriptRoot
& (Join-Path $scriptDir "Scan-RAM.ps1")

$today = Get-Date -Format "yyyy-MM-dd"
$reportsDir = Join-Path $scriptDir "reports"
$reportPath = Join-Path $reportsDir "ram-report-$today.md"
$countsPath = Join-Path $reportsDir "ram-counts.json"

if (-not (Test-Path $countsPath)) {
    exit
}

$counts = Get-Content $countsPath -Raw | ConvertFrom-Json

$gb = [math]::Round($counts.total_mb / 1024, 1)
$usedGb = [math]::Round($counts.used_mb / 1024, 1)
$freeGb = [math]::Round($counts.free_mb / 1024, 1)

$summary = "Reporte semanal de RAM ($today)`n`n" +
           "RAM total: $gb GB`n" +
           "RAM en uso: $usedGb GB ($($counts.usage_percent)%)`n" +
           "RAM libre: $freeGb GB`n" +
           "Procesos totales: $($counts.total_processes)`n" +
           "Candidatos a liberar (identificados): $($counts.known_processes)`n`n" +
           "Reporte completo: $reportPath`n`n" +
           "Deseas revisar y liberar memoria ahora?"

Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    "RAM Optimizer - Reporte semanal",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
)

if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    Start-Process $shell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $scriptDir 'Free-RAM.ps1')`""
}
