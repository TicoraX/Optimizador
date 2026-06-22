param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-Log { param([string]$Message) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; Add-Content -Path $logPath -Value $line }

$settings = @(
    @{ Name = 'Telemetria'; Key = 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection'; Value = 'AllowTelemetry'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Cortana'; Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\Windows Search'; Value = 'AllowCortana'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'ID de publicidad'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo'; Value = 'Enabled'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Experiencias personalizadas'; Key = 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Privacy'; Value = 'TailoredExperiencesWithDiagnosticDataEnabled'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Historial de actividad'; Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\System'; Value = 'EnableActivityFeed'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Ubicacion'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
    @{ Name = 'Camara'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
    @{ Name = 'Microfono'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
)

Write-Log "=== Proteccion de privacidad - inicio ==="

$selection = if ($env:OPTIMIZE_PRIVACY) { $env:OPTIMIZE_PRIVACY } else { '' }
$indices = @($selection -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })

if ($indices.Count -eq 0) {
    Write-Log "No se seleccionaron ajustes para proteger."
    Write-Log "=== Proteccion de privacidad - fin ==="; exit 0
}

$hardened = 0; $errors = 0
foreach ($idx in $indices) {
    $s = $settings[$idx - 1]
    if (-not $s) { Write-Log "Indice $idx fuera de rango, ignorado."; continue }

    Write-Log "Protegiendo: $($s.Name)..."
    $regOut = reg add $s.Key /v $s.Value /t $s.Type /d $s.Safe /f 2>&1
    if ($LASTEXITCODE -eq 0) {
        $hardened++; Write-Log "  Protegido: $($s.Name)"
    } else {
        $errors++; Write-Log "  ERROR protegiendo $($s.Name): $regOut"
    }
}

Write-Log "Resumen: $hardened protegidos, $errors errores"
Write-Log "=== Proteccion de privacidad - fin ==="
