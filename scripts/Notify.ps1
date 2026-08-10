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

# El resumen sale del backend, que ya resuelve su propio directorio de datos.
#
# Antes se armaba la ruta del counts.json a mano desde $PSScriptRoot: en la app
# instalada apuntaba dentro de resources (donde no hay reportes) y corriendo
# desde el repo leia una copia que el escaneo recien lanzado no habia tocado,
# porque el backend escribe en userData.
try {
    $status = Invoke-WebRequest -Uri "$base/api/status" -TimeoutSec 30 -UseBasicParsing |
        Select-Object -ExpandProperty Content | ConvertFrom-Json
} catch {
    Show-Popup "Escaneo de '$Module' completado, pero no se pudo leer el resumen." "Optimizador - $Module"
    exit 0
}

function Format-Counts($obj, $prefix = '') {
    foreach ($p in $obj.PSObject.Properties) {
        if ($p.Name -in @('lastScan', 'reportPath', 'error')) { continue }
        if ($p.Value -is [System.Management.Automation.PSCustomObject]) {
            Format-Counts $p.Value "$($p.Name) "
        } elseif ($p.Value -isnot [System.Array] -and -not [string]::IsNullOrWhiteSpace($p.Value)) {
            # Sin esto el popup lista los campos que no aplican (bateria y
            # desgaste en un equipo de escritorio) como lineas vacias.
            "$prefix$($p.Name): $($p.Value)"
        }
    }
}

$lines = Format-Counts $status.$Module

Show-Popup (($lines -join "`n") + "`n`nAbri Optimizador para ver el detalle y actuar.") "Optimizador - $Module"
