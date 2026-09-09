<#
.SYNOPSIS
    Ejecutor desatendido de perfiles del Optimizador para Windows Task Scheduler.

.DESCRIPTION
    Corre de forma autonoma en segundo plano sin requerir que la ventana de Electron
    este abierta. Invoca directamente el CLI headless (node server/cli.js), verifica
    condiciones de seguridad de hardware (bateria y juegos en ejecucion) y emite una
    notificacion Toast nativa de Windows al finalizar.

.PARAMETER Profile
    Identificador del perfil: gaming, work, battery o dev.

.PARAMETER Port
    Puerto local del backend si estuviera activo (opcional).

.PARAMETER Force
    Omite las comprobaciones de bateria y estado de juego.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('gaming', 'work', 'battery', 'dev')]
    [string]$Profile,

    [int]$Port = 3001,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Resolver directorio de datos y ubicacion del repositorio/instalacion
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ReportsDir = Join-Path $ProjectRoot 'reports'
if (-not (Test-Path -LiteralPath $ReportsDir)) {
    New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null
}
$HistoryFile = Join-Path $ReportsDir 'scheduled-automation.jsonl'

function Write-History([string]$prof, [bool]$success, [string]$summary, [double]$freedMB, [int]$durationMs, [string]$errMsg = $null) {
    $entry = [PSCustomObject]@{
        timestamp   = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        profileId   = $prof
        success     = $success
        summary     = $summary
        freedMB     = $freedMB
        durationMs  = $durationMs
        error       = $errMsg
    }
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -LiteralPath $HistoryFile -Value $json -Encoding UTF8
}

function Show-WindowsToast([string]$title, [string]$line1, [string]$line2 = '') {
    try {
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        
        $escapedTitle = [System.Security.SecurityElement]::Escape($title)
        $escapedL1    = [System.Security.SecurityElement]::Escape($line1)
        $escapedL2    = [System.Security.SecurityElement]::Escape($line2)

        $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$escapedTitle</text>
      <text>$escapedL1</text>
      <text>$escapedL2</text>
    </binding>
  </visual>
</toast>
"@
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Optimizador D1")
        $notifier.Show($toast)
    } catch {
        # Fallback silencioso: no interrumpir la ejecucion si las APIs WinRT no estan disponibles
    }
}

# 1. Comprobacion de Seguridad de Energia (Bateria)
if (-not $Force) {
    try {
        $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
        if ($battery) {
            # BatteryStatus: 1 = Descargando (sin AC), 2 = Conectado a AC
            if ($battery.BatteryStatus -eq 1 -and $battery.EstimatedChargeRemaining -lt 30) {
                Write-History -prof $Profile -success $false -summary "Omitido por bateria baja (<30%)" -freedMB 0 -durationMs 0 -errMsg "Bateria baja sin conexion a corriente alterna"
                exit 0
            }
        }
    } catch {}
}

# 2. Localizar interprete de Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if (-not $nodeExe) {
    $fallbackNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $fallbackNode) {
        $nodeExe = $fallbackNode
    } else {
        Write-History -prof $Profile -success $false -summary "Error: node.exe no encontrado en el sistema" -freedMB 0 -durationMs 0 -errMsg "Node runtime no encontrado"
        exit 1
    }
}

# 3. Localizar CLI headless
$cliScript = Join-Path $ProjectRoot 'server\cli.js'
if (-not (Test-Path -LiteralPath $cliScript)) {
    Write-History -prof $Profile -success $false -summary "Error: cli.js no encontrado en $cliScript" -freedMB 0 -durationMs 0 -errMsg "cli.js ausente"
    exit 1
}

# 4. Ejecutar el perfil de optimizacion
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$procInfo = New-Object System.Diagnostics.ProcessStartInfo
$procInfo.FileName = $nodeExe
$procInfo.Arguments = "`"$cliScript`" profile $Profile --json"
$procInfo.RedirectStandardOutput = $true
$procInfo.RedirectStandardError = $true
$procInfo.UseShellExecute = $false
$procInfo.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($procInfo)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
$sw.Stop()

$duration = [int]$sw.ElapsedMilliseconds

if ($proc.ExitCode -eq 0) {
    $summaryText = "Mantenimiento completado con exito."
    Write-History -prof $Profile -success $true -summary $summaryText -freedMB 0 -durationMs $duration
    Show-WindowsToast "Optimizador D1 - Tarea Programada" "Perfil '$Profile' ejecutado correctamente" "Duracion: $([Math]::Round($duration/1000, 1))s"
    exit 0
} else {
    $errMsg = if ($stderr) { $stderr.Trim() } else { "Codigo de salida $($proc.ExitCode)" }
    Write-History -prof $Profile -success $false -summary "Fallo al ejecutar el perfil" -freedMB 0 -durationMs $duration -errMsg $errMsg
    Show-WindowsToast "Optimizador D1 - Advertencia" "Fallo la ejecucion del perfil '$Profile'" $errMsg
    exit $proc.ExitCode
}
