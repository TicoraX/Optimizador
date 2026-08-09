<#
.SYNOPSIS
    Ejecuta el escaneo de un modulo del Optimizador y muestra el resumen.

.DESCRIPTION
    Un solo script para los 9 modulos, invocado por las tareas programadas de
    Windows. Antes existian 4 Notify-*.ps1 que reimplementaban la logica de su
    modulo y otros 5 que directamente no existian, asi que reprogramar una tarea
    fallaba con 500 en 7 de 9 modulos.

    No reimplementa nada: llama al backend, que ya es la unica fuente de verdad,
    y lee el JSON de conteos que el escaneo deja escrito.

.PARAMETER Module
    Clave del modulo: updates, cleanup, startup, ram, network, services, power,
    apps o privacy.

.PARAMETER Port
    Puerto del backend local. Por defecto 3001.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('updates','cleanup','startup','ram','network','services','power','apps','privacy')]
    [string]$Module,

    [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"

function Show-Popup([string]$text, [string]$title) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($text, $title) | Out-Null
}

# El backend solo acepta peticiones con Origin propio (ver server.js).
$headers = @{ 'Origin' = $base; 'Content-Type' = 'application/json' }

try {
    Invoke-WebRequest -Uri "$base/api/health" -TimeoutSec 5 -UseBasicParsing | Out-Null
} catch {
    Show-Popup "Optimizador no esta corriendo. Abri la aplicacion y volve a intentar." "Optimizador - $Module"
    exit 1
}

try {
    # El escaneo es de solo lectura: nunca modifica el sistema.
    Invoke-WebRequest -Uri "$base/api/scan/$Module" -Method Post -Headers $headers `
        -Body '{}' -TimeoutSec 600 -UseBasicParsing | Out-Null
} catch {
    Show-Popup "El escaneo de '$Module' fallo: $($_.Exception.Message)" "Optimizador - $Module"
    exit 1
}

# El escaneo deja el resumen en <modulo>/reports/<modulo>-counts.json.
$root = if ($env:OPTIMIZADOR_DATA_DIR) { $env:OPTIMIZADOR_DATA_DIR } else { Split-Path $PSScriptRoot -Parent }
$dirs = @{
    updates = 'update-checker'; cleanup = 'disk-cleanup'; startup = 'startup-optimizer'
    ram = 'ram-optimizer'; network = 'network-optimizer'; services = 'services-optimizer'
    power = 'power-optimizer'; apps = 'apps-manager'; privacy = 'privacy-optimizer'
}
$files = @{
    updates = 'update-counts.json'; cleanup = 'cleanup-counts.json'; startup = 'startup-counts.json'
    ram = 'ram-counts.json'; network = 'network-counts.json'; services = 'services-counts.json'
    power = 'power-counts.json'; apps = 'apps-counts.json'; privacy = 'privacy-counts.json'
}
$countsPath = Join-Path $root (Join-Path $dirs[$Module] "reports\$($files[$Module])")

if (-not (Test-Path $countsPath)) {
    Show-Popup "Escaneo de '$Module' completado, pero no se encontro el resumen." "Optimizador - $Module"
    exit 0
}

$counts = Get-Content $countsPath -Raw | ConvertFrom-Json
$lines = foreach ($p in $counts.PSObject.Properties) {
    if ($p.Name -in @('date','reportPath')) { continue }
    "$($p.Name): $($p.Value)"
}

Show-Popup (($lines -join "`n") + "`n`nAbri Optimizador para ver el detalle y actuar.") "Optimizador - $Module"
