param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "privacy-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "privacy-counts.json"

$settings = @(
    @{ Name = 'Telemetria'; Desc = 'Envio de datos de diagnostico'; Key = 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection'; Value = 'AllowTelemetry'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Cortana'; Desc = 'Asistente virtual'; Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\Windows Search'; Value = 'AllowCortana'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'ID de publicidad'; Desc = 'Identificador de publicidad'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo'; Value = 'Enabled'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Experiencias personalizadas'; Desc = 'Experiencias a medida con datos de diagnostico'; Key = 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Privacy'; Value = 'TailoredExperiencesWithDiagnosticDataEnabled'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Historial de actividad'; Desc = 'Historial de actividad en la nube'; Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\System'; Value = 'EnableActivityFeed'; Type = 'REG_DWORD'; Safe = '0' }
    @{ Name = 'Ubicacion'; Desc = 'Servicios de ubicacion'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
    @{ Name = 'Camara'; Desc = 'Acceso a camara'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
    @{ Name = 'Microfono'; Desc = 'Acceso a microfono'; Key = 'HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'; Value = 'Value'; Type = 'REG_SZ'; Safe = 'Deny' }
)

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de Privacidad - $timestamp")
$lines.Add("")
$lines.Add("## Configuracion de Privacidad ($($settings.Count) ajustes)")
$lines.Add("")
$lines.Add('```')

$hardened = 0
for ($i = 0; $i -lt $settings.Count; $i++) {
    $s = $settings[$i]
    $regOut = reg query $s.Key /v $s.Value 2>&1 | Out-String
    $current = $null
    $safe = $false
    if ($regOut -notmatch 'ERROR') {
        if ($s.Type -eq 'REG_DWORD') {
            if ($regOut -match '0x([\da-fA-F]+)') {
                $current = [string][int]("0x$($Matches[1])")
            }
        } else {
            if ($regOut -match 'REG_SZ\s+(.+?)$') { $current = $Matches[1].Trim() }
        }
    }
    if ($null -ne $current) { $safe = ($current -eq $s.Safe) }
    if ($safe) { $hardened++ }
    $label = if ($null -eq $current) { 'No configurado (por defecto)' } elseif ($safe) { 'Protegido' } else { 'No protegido' }
    $valStr = if ($null -ne $current) { "($current)" } else { '' }
    $lines.Add("[$($i+1)] $($s.Name) -- $($s.Desc) -- $label $valStr")
}

$lines.Add('```')
$lines.Add("")
$lines.Add("## Resumen")
$lines.Add("")
$lines.Add("- Ajustes analizados: $($settings.Count)")
$lines.Add("- Ya protegidos: $hardened")
$lines.Add("- Pendientes: $($settings.Count - $hardened)")
$lines.Add("")

$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{
    date            = $timestamp
    reportPath      = $reportPath
    total_settings  = $settings.Count
    hardened_count  = $hardened
    error           = $false
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
