<#
.SYNOPSIS
    Interactively cleans temp files, browser cache, old downloads, and recycle bin,
    asking per category before deleting anything. Logs actions to apply-log.txt.

.PARAMETER DownloadsAgeDays
    Files in Downloads older than this many days are eligible for deletion. Default 30.

.PARAMETER LogDir
    Directory where the run log is appended. Defaults to ./reports next to this script.
#>

param(
    [int]$DownloadsAgeDays = 30,
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

# Override via env var para ejecucion no-interactiva desde el backend
if ($env:DOWNLOADS_AGE_DAYS) { $DownloadsAgeDays = [int]$env:DOWNLOADS_AGE_DAYS }

Import-Module (Join-Path $PSScriptRoot "Common.psm1") -Force

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "apply-log.txt"

function Write-Log {
    param([string]$Message)
    Common\Write-Log -Message $Message -LogPath $logPath
}

Write-Log "=== Limpieza de disco - inicio ==="

Write-Host "=== Limpieza de disco ===" -ForegroundColor Cyan

if (Confirm-Action "Borrar temporales de Windows (%TEMP%, Windows\Temp, Prefetch)?") {
    try {
        Get-ChildItem -Path $env:TEMP -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
        Write-Host "  %TEMP% limpiado." -ForegroundColor Green
    } catch { Write-Log "Error limpiando %TEMP%: $($_.Exception.Message)" }

    try {
        Get-ChildItem -Path "$env:WINDIR\Temp" -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
        Write-Host "  Windows\Temp limpiado." -ForegroundColor Green
    } catch { Write-Log "Error limpiando Windows\Temp: $($_.Exception.Message)" }

    try {
        $ErrorActionPreference = 'Stop'
        Get-ChildItem -Path "$env:WINDIR\Prefetch" -Force |
            Remove-Item -Force | Out-Null
        Write-Host "  Prefetch limpiado." -ForegroundColor Green
    } catch { Write-Log "Prefetch requiere admin o esta en uso." }

    Write-Log "Temporales de Windows borrados."
}

if (Confirm-Action "Borrar cache de navegadores (Chrome, Edge, Firefox)?") {
    $cachePaths = @(
        "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache",
        "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache"
    )
    foreach ($p in $cachePaths) {
        if (Test-Path $p) {
            try {
                Get-ChildItem -Path $p -Force -ErrorAction SilentlyContinue |
                    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "  Cache borrado: $p" -ForegroundColor Green
            } catch { Write-Log "Error borrando cache: $($_.Exception.Message)" }
        }
    }
    # Firefox: purge cache2/ entries under each profile
    $ffProfilesRoot = "$env:APPDATA\Mozilla\Firefox\Profiles"
    if (Test-Path $ffProfilesRoot) {
        foreach ($profileDir in Get-ChildItem -Path $ffProfilesRoot -Directory -ErrorAction SilentlyContinue) {
            foreach ($cacheDir in @("cache2", "startupCache")) {
                $target = Join-Path $profileDir.FullName $cacheDir
                if (Test-Path $target) {
                    try {
                        Get-ChildItem -Path $target -Recurse -Force -ErrorAction SilentlyContinue |
                            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
                        Write-Host "  Firefox $cacheDir borrado: $($profileDir.Name)" -ForegroundColor Green
                    } catch { Write-Log "Error borrando Firefox $cacheDir : $($_.Exception.Message)" }
                }
            }
        }
    }
    Write-Log "Cache de navegadores borrado (cierra el navegador antes para mejores resultados)."
}

if (Confirm-Action "Borrar archivos en Descargas con mas de $DownloadsAgeDays dias?") {
    $downloadsPath = Join-Path $env:USERPROFILE "Downloads"
    if (Test-Path $downloadsPath) {
        $cutoff = (Get-Date).AddDays(-$DownloadsAgeDays)
        $oldFiles = Get-ChildItem -Path $downloadsPath -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.LastWriteTime -lt $cutoff }
        if ($oldFiles) {
            $deletedCount = $oldFiles.Count
            $oldFiles | Remove-Item -Force -ErrorAction SilentlyContinue
            Write-Log "Descargas viejas borradas: $deletedCount archivos."
        } else {
            Write-Host "  No hay archivos viejos para borrar." -ForegroundColor Yellow
        }
    } else {
        Write-Log "Descargas no encontrada."
    }
    Write-Host "  Descargas viejas borradas." -ForegroundColor Green
}

if (Confirm-Action "Vaciar papelera de reciclaje?") {
    if ($env:AUTO_CONFIRM -eq 'true') {
        try {
            $job = Start-Job -ScriptBlock { Clear-RecycleBin -Force -ErrorAction Stop }
            $completed = Wait-Job $job -Timeout 15
            if (-not $completed) {
                Stop-Job $job -PassThru | Remove-Job -Force
                Write-Log "Clear-RecycleBin excedio timeout (15s) - omitido para evitar cuelgue"
                Write-Host "  Papelera: omitida (timeout, posible bloqueo de UI)" -ForegroundColor DarkYellow
            } else {
                Receive-Job $job
                Write-Log "Papelera vaciada."
                Write-Host "  Papelera vaciada." -ForegroundColor Green
            }
            Remove-Job $job -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Log "Error al vaciar papelera: $($_.Exception.Message)"
            Write-Host "  No se pudo vaciar la papelera." -ForegroundColor Red
        }
    } else {
        try {
            Clear-RecycleBin -Force -ErrorAction Stop
            Write-Log "Papelera vaciada."
            Write-Host "  Papelera vaciada." -ForegroundColor Green
        } catch {
            Write-Log "Error al vaciar papelera: $($_.Exception.Message)"
            Write-Host "  No se pudo vaciar la papelera." -ForegroundColor Red
        }
    }
}

Write-Log "=== Limpieza de disco - fin ==="
Write-Host "Listo." -ForegroundColor Green
