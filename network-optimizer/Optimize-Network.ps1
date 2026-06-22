param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-Log { param([string]$Message) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; Add-Content -Path $logPath -Value $line }

Write-Log "=== Optimizacion de Red - inicio ==="

Write-Log "Limpiando cache DNS..."
$flush = ipconfig /flushdns 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Log "Cache DNS limpiada exitosamente."
} else {
    Write-Log "ERROR limpiando cache DNS: $flush"
}

Write-Log "Re-registrando DNS..."
$reg = ipconfig /registerdns 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Log "DNS re-registrado exitosamente."
} else {
    Write-Log "ERROR re-registrando DNS: $reg"
}

Write-Log "=== Optimizacion de Red - fin ==="
Write-Host "`nListo." -ForegroundColor Green
