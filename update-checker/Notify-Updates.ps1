<#
.SYNOPSIS
    Weekly entry point: generates the update report and shows a popup summary.
    If the user accepts, launches Apply-Updates.ps1 in an interactive window.
#>

$scriptDir = $PSScriptRoot
& (Join-Path $scriptDir "Check-Updates.ps1")

$today = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path (Join-Path $scriptDir "reports") "update-report-$today.md"
$countsPath = Join-Path (Join-Path $scriptDir "reports") "update-counts.json"

if (-not (Test-Path $countsPath)) {
    exit
}

$counts = Get-Content $countsPath -Raw | ConvertFrom-Json

function Format-PopupLine {
    param([string]$Label, $Data)
    if ($Data.error) { return "$Label`: error" }
    return "$Label`: $($Data.count)"
}

$lines = @(
    (Format-PopupLine "Winget" $counts.winget)
    (Format-PopupLine "Pip" $counts.pip)
    (Format-PopupLine "npm" $counts.npm)
    (Format-PopupLine "Choco" $counts.choco)
) -join "`n"

$summary = "Reporte semanal de actualizaciones ($today)`n`n" +
           "$lines`n`n" +
           "Reporte completo: $reportPath`n`n" +
           "Deseas revisar e instalar actualizaciones ahora?"

Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    "Update Checker - Reporte semanal",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
)

if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    Start-Process $shell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $scriptDir 'Apply-Updates.ps1')`""
}
