param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-Log { param([string]$Message) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; Add-Content -Path $logPath -Value $line }

Write-Log "=== Optimizacion de Servicios - inicio ==="

$selection = if ($env:OPTIMIZE_SERVICES) { $env:OPTIMIZE_SERVICES } else { '' }
$indices = @($selection -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })

if ($indices.Count -eq 0) {
    Write-Log "No se seleccionaron servicios para optimizar."
    Write-Log "=== Optimizacion de Servicios - fin ==="
    exit 0
}

$thirdParty = [System.Collections.Generic.List[PSCustomObject]]::new()
try {
    $svcs = Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' }
    foreach ($s in $svcs) {
        $path = ([string]$s.PathName).ToLower()
        $isMs = $path -match '\\windows\\' -or $path -match '\\system32\\' -or $path -match '\\winsxs\\' -or $path -eq ''
        if (-not $isMs) { $thirdParty.Add($s) }
    }
} catch {
    Write-Log "Error al re-escanear servicios: $_"
    exit 1
}

$stopped = 0; $disabled = 0; $errors = 0
foreach ($idx in $indices) {
    $s = $thirdParty[$idx - 1]
    if (-not $s) { Write-Log "Indice $idx fuera de rango, ignorado."; continue }

    Write-Log "Procesando: $($s.Name) ($($s.DisplayName))"

    if ($s.State -eq 'Running') {
        $stopOut = & sc stop "$($s.Name)" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $stopped++; Write-Log "  Detenido: $($s.Name)"
        } else {
            $errors++; Write-Log "  ERROR deteniendo $($s.Name): $stopOut"
            continue
        }
    }

    $configOut = & sc config "$($s.Name)" start= disabled 2>&1
    if ($LASTEXITCODE -eq 0) {
        $disabled++; Write-Log "  Deshabilitado: $($s.Name)"
    } else {
        $errors++; Write-Log "  ERROR deshabilitando $($s.Name): $configOut"
    }
}

Write-Log "Resumen: $stopped detenidos, $disabled deshabilitados, $errors errores"
Write-Log "=== Optimizacion de Servicios - fin ==="
