<#
.SYNOPSIS
    Interactively frees RAM by terminating selected processes. Logs actions
    to optimize-log.txt. Supports AUTO_CONFIRM for non-interactive execution.

.PARAMETER LogDir
    Directory where the run log is appended. Defaults to ./reports next to this script.
#>

param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

$commonPath = Join-Path $PSScriptRoot "Common.psm1"
if (Test-Path $commonPath) {
    Import-Module $commonPath -Force
} else {
    function Test-CommandExists { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
    function Confirm-Action { param([string]$Message) if ($env:AUTO_CONFIRM -eq 'true') { Write-Host "$Message (auto-confirmado: si)"; return $true }; if ($host.Name -notmatch 'ConsoleHost') { Write-Host "$Message (auto-confirmado: no interactivo)"; return $true }; $a = Read-Host "$Message (s/n)"; return $a -match '^[sSyY]' }
    function Write-Log { param([string]$Message, [string]$LogPath) $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"; Write-Host $line; if ($LogPath) { Add-Content -Path $LogPath -Value $line } }
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "optimize-log.txt"

function Write-LogLocal {
    param([string]$Message)
    Write-Log -Message $Message -LogPath $logPath
}

Write-LogLocal "=== Liberacion de RAM - inicio ==="

function Parse-IndexSelection {
    param([string]$Selection, [int]$MaxIndex)
    if ($Selection.Trim() -eq 'todos') { return 0..($MaxIndex - 1) }
    $result = @()
    foreach ($part in ($Selection -split ',')) {
        $trimmed = $part.Trim()
        if ($trimmed -match '^\d+$') {
            $idx = [int]$trimmed - 1
            if ($idx -ge 0 -and $idx -lt $MaxIndex) { $result += $idx }
            else { Write-Host "  Numero fuera de rango ignorado: $trimmed" -ForegroundColor DarkYellow }
        } else {
            Write-Host "  Valor no numerico ignorado: '$part'" -ForegroundColor DarkYellow
        }
    }
    return $result
}

Write-Host "=== Liberador de RAM ===" -ForegroundColor Cyan

# ──────────────────────────────────────────────────────
# 1. List processes sorted by memory
# ──────────────────────────────────────────────────────
$protectedPids = Get-ProtectedPids
$procs = Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending
$entries = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($p in $procs) {
    $mb = [math]::Round($p.WorkingSet64 / 1MB, 0)
    if ($mb -le 0) { continue }
    $procName = "$($p.ProcessName).exe"
    $hasWindow = -not [string]::IsNullOrWhiteSpace($p.MainWindowTitle)
    $tier = if ($protectedPids.Contains($p.Id)) { 'critical' } else { Get-ProcessTier -Name $procName -HasWindow $hasWindow }
    $entries.Add([PSCustomObject]@{
        Name      = $procName
        PID       = $p.Id
        MB        = $mb
        Tier      = $tier
        HasWindow = $hasWindow
        Critical  = ($tier -in @('critical', 'risky'))
    })
}

$cleanMode = if ($env:CLEAN_MODE -eq 'deep') { 'deep' } else { 'soft' }
$threshold = if ($cleanMode -eq 'deep') { 10 } else { 50 }

# Solo procesos 'safe_known' son candidatos automaticos - 'unknown' requiere
# seleccion manual (el usuario los elige uno por uno). 'risky' y 'critical'
# nunca se liberan aqui. En modo 'deep' se incluyen unknown sin ventana.
$candidates = $entries | Where-Object { $_.Tier -eq 'safe_known' -and $_.MB -ge $threshold }
$deepUnknownPids = @{}
if ($cleanMode -eq 'deep') {
    $deepUnknown = $entries | Where-Object { $_.Tier -eq 'unknown' -and -not $_.HasWindow -and $_.MB -ge $threshold }
    $candidates = @($candidates) + @($deepUnknown)
    foreach ($p in $deepUnknown) { $deepUnknownPids[$p.PID] = $true }
}
# Mismo criterio que Scan-RAM.ps1: lo que ya entro automaticamente a
# $candidates no se vuelve a listar en la seleccion manual de "unknown".
$unknownEntries = $entries | Where-Object { $_.Tier -eq 'unknown' -and $_.MB -ge $threshold -and -not $deepUnknownPids.ContainsKey($_.PID) }
$riskyEntries = $entries | Where-Object { $_.Tier -eq 'risky' -and $_.MB -ge $threshold }

if ($candidates.Count -gt 0) {
    Write-Host "`n--- Procesos candidatos a liberar ($($candidates.Count)) ---" -ForegroundColor Yellow
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        Write-Host "[$($i + 1)] $($candidates[$i].Name)  PID: $($candidates[$i].PID)  $($candidates[$i].MB) MB"
    }

    if (Confirm-Action "Terminar procesos seleccionados para liberar RAM?") {
        if ($env:AUTO_CONFIRM -eq 'true') {
            $sel = if ($env:OPTIMIZE_PROCESSES) { $env:OPTIMIZE_PROCESSES } else { '' }
            Write-Host "Seleccion via env (auto): $sel"
        } else {
            $sel = Read-Host "Ingresa los numeros a terminar (separados por coma, o escribe 'todos')"
        }
        $indices = Parse-IndexSelection -Selection $sel -MaxIndex $candidates.Count

        $killed = 0
        $errors = 0
        $freedMB = 0
        foreach ($idx in $indices) {
            if ($idx -lt 0 -or $idx -ge $candidates.Count) { continue }
            $e = $candidates[$idx]
            if ($e.Critical) {
                Write-Host "  Omitido (critico): $($e.Name)" -ForegroundColor DarkYellow
                Write-LogLocal "OMITIDO (critico): $($e.Name) (PID: $($e.PID))"
                continue
            }
            try {
                Stop-Process -Id $e.PID -Force -ErrorAction Stop
                Write-Host "  Terminado: $($e.Name) (PID: $($e.PID)) - $($e.MB) MB liberados" -ForegroundColor Green
                Write-LogLocal "Terminado: $($e.Name) (PID: $($e.PID)) - $($e.MB) MB"
                $killed++
                $freedMB += $e.MB
            } catch {
                Write-Host "  Error terminando $($e.Name): $($_.Exception.Message)" -ForegroundColor Red
                Write-LogLocal "ERROR terminando $($e.Name) (PID: $($e.PID)): $($_.Exception.Message)"
                $errors++
            }
        }
        Write-Host "`nResumen: $killed terminados, $errors errores, ~$freedMB MB liberados" -ForegroundColor Cyan
        Write-LogLocal "Resumen: $killed terminados, $errors errores, ~$freedMB MB liberados"
    }
} else {
    Write-Host "`nNo hay procesos candidatos con consumo >= 50 MB." -ForegroundColor Yellow
}

# ──────────────────────────────────────────────────────
# 1b. Procesos no identificados (unknown) - el usuario los elige manualmente
# ──────────────────────────────────────────────────────
if ($unknownEntries.Count -gt 0) {
    Write-Host "`n--- Procesos no identificados ($($unknownEntries.Count)) ---" -ForegroundColor DarkYellow
    Write-Host "Estos procesos no tienen una descripcion conocida. Revise antes de liberar." -ForegroundColor DarkYellow
    for ($i = 0; $i -lt $unknownEntries.Count; $i++) {
        Write-Host "[$($i + 1)] $($unknownEntries[$i].Name)  PID: $($unknownEntries[$i].PID)  $($unknownEntries[$i].MB) MB"
    }

    if (Confirm-Action "Terminar procesos NO IDENTIFICADOS? (bajo su responsabilidad)") {
        if ($env:AUTO_CONFIRM -eq 'true') {
            $unknownSel = if ($env:UNKNOWN_PROCESSES) { $env:UNKNOWN_PROCESSES } else { '' }
            Write-Host "Seleccion via env (auto): $unknownSel"
        } else {
            $unknownSel = Read-Host "Ingresa los numeros a terminar (separados por coma, o escribe 'todos')"
        }
        $unknownIndices = Parse-IndexSelection -Selection $unknownSel -MaxIndex $unknownEntries.Count

        foreach ($idx in $unknownIndices) {
            if ($idx -lt 0 -or $idx -ge $unknownEntries.Count) { continue }
            $e = $unknownEntries[$idx]
            try {
                Stop-Process -Id $e.PID -Force -ErrorAction Stop
                Write-Host "  Terminado (no identificado): $($e.Name) (PID: $($e.PID)) - $($e.MB) MB liberados" -ForegroundColor Green
                Write-LogLocal "Terminado (no identificado): $($e.Name) (PID: $($e.PID)) - $($e.MB) MB"
                $killed++
                $freedMB += $e.MB
            } catch {
                Write-Host "  Error terminando $($e.Name): $($_.Exception.Message)" -ForegroundColor Red
                Write-LogLocal "ERROR terminando (no identificado) $($e.Name) (PID: $($e.PID)): $($_.Exception.Message)"
                $errors++
            }
        }
    }
}

# ──────────────────────────────────────────────────────
# 1c. Procesos "no recomendados" (risky: editores/navegadores/sync/chat) -
#     NUNCA automatico. Requiere confirmacion explicita adicional, distinta
#     de la confirmacion general, porque cerrarlos pierde trabajo/sesion.
# ──────────────────────────────────────────────────────
if ($riskyEntries.Count -gt 0) {
    Write-Host "`n--- Procesos NO RECOMENDADOS ($($riskyEntries.Count)) ---" -ForegroundColor Red
    Write-Host "Editores, navegadores, sincronizacion, chat: cerrarlos sin guardar pierde tu trabajo o sesion." -ForegroundColor Red
    for ($i = 0; $i -lt $riskyEntries.Count; $i++) {
        Write-Host "[$($i + 1)] $($riskyEntries[$i].Name)  PID: $($riskyEntries[$i].PID)  $($riskyEntries[$i].MB) MB"
    }

    if (Confirm-Action "Entiende el riesgo y quiere cerrar procesos de esta lista? (perdera trabajo/sesion no guardado)") {
        if ($env:AUTO_CONFIRM -eq 'true') {
            $riskySel = if ($env:RISKY_PROCESSES) { $env:RISKY_PROCESSES } else { '' }
            Write-Host "Seleccion via env (auto): $riskySel"
        } else {
            $riskySel = Read-Host "Ingresa los numeros a terminar (separados por coma, o escribe 'todos')"
        }
        $riskyIndices = Parse-IndexSelection -Selection $riskySel -MaxIndex $riskyEntries.Count

        foreach ($idx in $riskyIndices) {
            if ($idx -lt 0 -or $idx -ge $riskyEntries.Count) { continue }
            $e = $riskyEntries[$idx]
            try {
                Stop-Process -Id $e.PID -Force -ErrorAction Stop
                Write-Host "  Terminado (no recomendado, confirmado): $($e.Name) (PID: $($e.PID)) - $($e.MB) MB liberados" -ForegroundColor Green
                Write-LogLocal "Terminado (no recomendado, confirmado): $($e.Name) (PID: $($e.PID)) - $($e.MB) MB"
                $killed++
                $freedMB += $e.MB
            } catch {
                Write-Host "  Error terminando $($e.Name): $($_.Exception.Message)" -ForegroundColor Red
                Write-LogLocal "ERROR terminando (no recomendado) $($e.Name) (PID: $($e.PID)): $($_.Exception.Message)"
                $errors++
            }
        }
    }
}

# ──────────────────────────────────────────────────────
# 2. Liberar working sets (mueve paginas de cada proceso a standby - no baja
#    el % de "RAM en uso" reportado por si solo, ver paso 3)
# ──────────────────────────────────────────────────────
Write-Host "`n--- Liberando working sets ---" -ForegroundColor Cyan
$standbyFreed = 0
$procs = Get-Process -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    try {
        $before = $p.WorkingSet64
        $p.EmptyWorkingSet()
        $after = $p.WorkingSet64
        if ($before -gt $after) { $standbyFreed += [math]::Round(($before - $after) / 1MB, 0) }
    } catch {}
}
Write-Host "Working sets liberados: ~$standbyFreed MB" -ForegroundColor Green
Write-LogLocal "Working sets liberados: ~$standbyFreed MB"

# ──────────────────────────────────────────────────────
# 3. Vaciar la standby list de verdad (requiere administrador). Esto SI
#    baja el % de uso de RAM reportado, a diferencia de EmptyWorkingSet.
# ──────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "`nVaciar lista en espera: OMITIDO (ejecuta este script como administrador para liberar mas memoria)." -ForegroundColor DarkYellow
    Write-LogLocal "Vaciar lista en espera: OMITIDO (no administrador)"
} else {
    Write-Host "`n--- Vaciando lista en espera (standby list) ---" -ForegroundColor Cyan
    if (Clear-StandbyList) {
        Write-Host "Lista en espera vaciada correctamente." -ForegroundColor Green
        Write-LogLocal "Lista en espera vaciada correctamente."
    } else {
        Write-Host "Error vaciando la lista en espera." -ForegroundColor Red
        Write-LogLocal "ERROR vaciando lista en espera."
    }
}

Write-LogLocal "=== Liberacion de RAM - fin ==="
Write-Host "`nListo." -ForegroundColor Green
