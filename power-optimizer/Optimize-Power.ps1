param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-Log { param([string]$Message) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; Add-Content -Path $logPath -Value $line }

Write-Log "=== Cambio de plan de energia - inicio ==="

$planIndex = if ($env:PLAN_INDEX -match '^\d+$') { [int]$env:PLAN_INDEX } else { 0 }
if ($planIndex -lt 1) {
    Write-Log "No se selecciono un plan valido."
    Write-Log "=== Cambio de plan de energia - fin ==="; exit 0
}

$plans = @()
$listOut = powercfg /list 2>&1 | Out-String
foreach ($line in ($listOut -split "`r`n")) {
    if ($line -match '([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}).*\((.+?)\)') {
        $plans += [PSCustomObject]@{ Guid = $Matches[1]; Name = $Matches[2] }
    }
}

$target = $plans[$planIndex - 1]
if (-not $target) {
    Write-Log "Indice $planIndex fuera de rango."
    Write-Log "=== Cambio de plan de energia - fin ==="; exit 1
}

Write-Log "Cambiando a: $($target.Name) ($($target.Guid))"
powercfg /setactive $target.Guid 2>&1 | Out-Null
$pwrcfgExit = $LASTEXITCODE
if ($pwrcfgExit -eq 0) {
    Write-Log "Plan activado: $($target.Name)"
} else {
    Write-Log "ERROR al cambiar plan (codigo $pwrcfgExit)"
}

Write-Log "=== Cambio de plan de energia - fin ==="
