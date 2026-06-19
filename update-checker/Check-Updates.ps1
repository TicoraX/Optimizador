<#
.SYNOPSIS
    Checks for outdated drivers, apps (winget), Python packages (pip),
    global npm packages, and Chocolatey packages. Writes a Markdown report
    plus a sidecar JSON with counts for other scripts to consume.

.DESCRIPTION
    Standalone, generic update checker. No hardcoded user paths/secrets.
    Designed to be run manually or via a scheduled task / Claude Code routine.

.PARAMETER ReportDir
    Directory where the .md report will be saved. Defaults to ./reports next to this script.

.EXAMPLE
    pwsh -File Check-Updates.ps1
#>

param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

Import-Module (Join-Path $PSScriptRoot "Common.psm1") -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "update-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "update-counts.json"

function Format-CountLine {
    param([string]$Label, [int]$Count, [bool]$IsError)
    if ($IsError) { return "- $Label`: error (ver detalle abajo)" }
    return "- $Label`: $Count disponibles"
}

# --- Winget (apps + drivers) ---
$wingetCount = 0
$wingetError = $false
$wingetBlock = "winget no esta disponible en este sistema."
if (Test-CommandExists "winget") {
    try {
        # winget has no JSON/structured output for `upgrade` (checked via winget upgrade --help,
        # v1.28). Table parsing by header position is the most robust option available;
        # if Microsoft changes the column header text this will need updating.
        $wingetRaw = @(winget upgrade --include-unknown --disable-interactivity --accept-source-agreements 2>$null)
        $headerIdx = -1
        for ($i = 0; $i -lt $wingetRaw.Count; $i++) {
            if ($wingetRaw[$i] -match '^Name\s+Id\s+Version\s+Available') { $headerIdx = $i; break }
        }
        if ($headerIdx -ge 0) {
            $tableLines = $wingetRaw[$headerIdx..($wingetRaw.Count - 1)]
            $dataRows = $tableLines | Where-Object {
                $_ -notmatch '^-+$' -and $_ -ne $tableLines[0] -and $_ -notmatch '^\d+\s+upgrades? available'
            }
            $wingetCount = $dataRows.Count
            if ($wingetCount -eq 0) {
                $wingetBlock = "Todo actualizado."
            } else {
                $body = (@($tableLines[0]) + $dataRows) -join "`n"
                $wingetBlock = '```' + "`n" + $body + "`n" + '```'
            }
        } else {
            $wingetBlock = "Todo actualizado."
        }
    } catch {
        $wingetError = $true
        $wingetBlock = "Error al ejecutar winget: $($_.Exception.Message)"
    }
}

# --- Python (pip) ---
$pipCount = 0
$pipError = $false
$pipBlock = "pip no esta disponible en este sistema."
if (Test-CommandExists "pip") {
    try {
        $pipJson = (pip list --outdated --format=json 2>$null) -join "`n"
        $pipParsed = $pipJson | ConvertFrom-Json
        $pipPackages = if ($pipParsed -is [array]) { $pipParsed } else { @($pipParsed) }
        $pipCount = $pipPackages.Count
        if ($pipCount -eq 0) {
            $pipBlock = "Todos los paquetes pip estan actualizados."
        } else {
            $rows = $pipPackages | ForEach-Object { "{0,-40} {1,-12} {2}" -f $_.name, $_.version, $_.latest_version }
            $header = "{0,-40} {1,-12} {2}" -f "Package", "Version", "Latest"
            $pipBlock = '```' + "`n" + $header + "`n" + ($rows -join "`n") + "`n" + '```'
        }
    } catch {
        $pipError = $true
        $pipBlock = "Error al ejecutar pip: $($_.Exception.Message)"
    }
}

# --- npm global ---
$npmCount = 0
$npmError = $false
$npmBlock = "npm no esta disponible en este sistema."
if (Test-CommandExists "npm") {
    try {
        $npmJson = (npm outdated -g --json 2>$null) -join "`n"
        if ([string]::IsNullOrWhiteSpace($npmJson) -or $npmJson -eq "{}") {
            $npmBlock = "Todos los paquetes npm globales estan actualizados."
        } else {
            $npmObj = $npmJson | ConvertFrom-Json
            $names = @($npmObj.PSObject.Properties.Name) | Where-Object { $_ -ne "error" }
            $npmCount = $names.Count
            if ($npmObj.PSObject.Properties.Name -contains "error") {
                $npmCount = 0
                $npmError = $true
                $npmBlock = "Error al ejecutar npm: $($npmObj.error.summary)"
            }
            elseif ($npmCount -eq 0) {
                $npmBlock = "Todos los paquetes npm globales estan actualizados."
            } else {
                $rows = $names | ForEach-Object {
                    $p = $npmObj.$_
                    "{0,-30} {1,-12} {2}" -f $_, $p.current, $p.latest
                }
                $header = "{0,-30} {1,-12} {2}" -f "Package", "Current", "Latest"
                $npmBlock = '```' + "`n" + $header + "`n" + ($rows -join "`n") + "`n" + '```'
            }
        }
    } catch {
        $npmError = $true
        $npmBlock = "Error al ejecutar npm: $($_.Exception.Message)"
    }
}

# --- Chocolatey ---
$chocoCount = 0
$chocoError = $false
$chocoBlock = "Chocolatey no esta instalado en este sistema."
if (Test-CommandExists "choco") {
    try {
        $chocoRaw = choco outdated -r --no-color 2>$null
        $chocoLines = @($chocoRaw | Where-Object { $_ -match '\|' })
        $chocoCount = $chocoLines.Count
        if ($chocoCount -eq 0) {
            $chocoBlock = "Todos los paquetes choco estan actualizados."
        } else {
            $rows = $chocoLines | ForEach-Object {
                $parts = $_ -split '\|'
                "{0,-30} {1,-12} {2}" -f $parts[0], $parts[1], $parts[2]
            }
            $header = "{0,-30} {1,-12} {2}" -f "Package", "Current", "Available"
            $chocoBlock = '```' + "`n" + $header + "`n" + ($rows -join "`n") + "`n" + '```'
        }
    } catch {
        $chocoError = $true
        $chocoBlock = "Error al ejecutar choco: $($_.Exception.Message)"
    }
}

$summary = @(
    "# Reporte de actualizaciones - $timestamp"
    ""
    "## Resumen"
    ""
    (Format-CountLine "Winget" $wingetCount $wingetError)
    (Format-CountLine "Pip" $pipCount $pipError)
    (Format-CountLine "npm" $npmCount $npmError)
    (Format-CountLine "Choco" $chocoCount $chocoError)
    ""
    "## Winget (apps y drivers)"
    ""
    $wingetBlock
    ""
    "## Python (pip)"
    ""
    $pipBlock
    ""
    "## npm (paquetes globales)"
    ""
    $npmBlock
    ""
    "## Chocolatey"
    ""
    $chocoBlock
    ""
)

$summary -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{
    date       = $timestamp
    reportPath = $reportPath
    winget     = @{ count = $wingetCount; error = $wingetError }
    pip        = @{ count = $pipCount; error = $pipError }
    npm        = @{ count = $npmCount; error = $npmError }
    choco      = @{ count = $chocoCount; error = $chocoError }
} | ConvertTo-Json | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
