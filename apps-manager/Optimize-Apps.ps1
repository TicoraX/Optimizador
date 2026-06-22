param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-Log { param([string]$Message) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; Add-Content -Path $logPath -Value $line }

Write-Log "=== Desinstalacion de aplicaciones - inicio ==="

$selection = if ($env:OPTIMIZE_APPS) { $env:OPTIMIZE_APPS } else { '' }
$ids = @($selection -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })

if ($ids.Count -eq 0) {
    Write-Log "No se seleccionaron aplicaciones para desinstalar."
    Write-Log "=== Desinstalacion de aplicaciones - fin ==="; exit 0
}

$uninstalled = 0; $errors = 0
foreach ($id in $ids) {
    Write-Log "Desinstalando: $id..."
    $ur = winget uninstall --id $id --silent --accept-source-agreements 2>&1
    if ($LASTEXITCODE -eq 0) {
        $uninstalled++; Write-Log "  Desinstalado: $id"
    } else {
        $errors++; Write-Log "  ERROR desinstalando $id: $ur"
    }
}

Write-Log "Resumen: $uninstalled desinstalados, $errors errores"
Write-Log "=== Desinstalacion de aplicaciones - fin ==="
