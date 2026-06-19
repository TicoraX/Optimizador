<#
.SYNOPSIS
    Interactively disables selected startup programs and logon tasks,
    asking per category with a numbered list. Logs actions to apply-log.txt.

.PARAMETER LogDir
    Directory where the run log is appended. Defaults to ./reports next to this script.
#>

param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

# Import shared helpers via update-checker's module
$commonPath = Join-Path $PSScriptRoot "..\update-checker\Common.psm1"
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

Write-LogLocal "=== Optimizacion de inicio - inicio ==="

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

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

Write-Host "=== Optimizador de inicio ===" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════
# 1. Startup Programs
# ═══════════════════════════════════════════════════
$entries = [System.Collections.Generic.List[PSCustomObject]]::new()

$regPaths = @(
    @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKCU)" }
    @{ Path = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKLM)" }
    @{ Path = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKLM 32-bit)" }
)

foreach ($rp in $regPaths) {
    if (Test-Path $rp.Path) {
        try {
            $props = Get-ItemProperty -LiteralPath $rp.Path -ErrorAction SilentlyContinue
            if ($props) {
                $propNames = $props.PSObject.Properties |
                    Where-Object { $_.Name -notin @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider') }
                foreach ($pn in $propNames) {
                    $entries.Add([PSCustomObject]@{
                        Name    = $pn.Name
                        Command = $pn.Value
                        Source  = $rp.Label
                        KeyPath = $rp.Path
                        Type    = "Registry"
                    })
                }
            }
        } catch {}
    }
}

$startupFolders = @(
    @{ Path = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"; Label = "Carpeta Startup (usuario)" }
    @{ Path = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup"; Label = "Carpeta Startup (global)" }
)

$wshShell = New-Object -ComObject WScript.Shell
foreach ($sf in $startupFolders) {
    if (Test-Path $sf.Path) {
        $shortcuts = Get-ChildItem -Path $sf.Path -Filter "*.lnk" -ErrorAction SilentlyContinue
        foreach ($sc in $shortcuts) {
            try {
                $target = $wshShell.CreateShortcut($sc.FullName).TargetPath
            } catch { $target = "desconocido" }
            $entries.Add([PSCustomObject]@{
                Name    = $sc.BaseName
                Command = $target
                Source  = $sf.Label
                KeyPath = $sc.FullName
                Type    = "Shortcut"
            })
        }
    }
}

if ($entries.Count -gt 0) {
    Write-Host "`n--- Programas de inicio ($($entries.Count)) ---" -ForegroundColor Yellow
    for ($i = 0; $i -lt $entries.Count; $i++) {
        $note = if ($entries[$i].Source -match 'HKLM' -and -not $isAdmin) { " [ADMIN REQUERIDO]" } else { "" }
        Write-Host "[$($i + 1)] $($entries[$i].Name)  [$($entries[$i].Source)]$note"
    }

    if (Confirm-Action "Deshabilitar algun programa de inicio?") {
        if ($env:AUTO_CONFIRM -eq 'true') {
            if ($env:OPTIMIZE_PROGRAMS) {
                $sel = $env:OPTIMIZE_PROGRAMS
                Write-Host "Seleccion de programas via env (auto): $sel"
            } else {
                Write-Host "Sin seleccion de programas (AUTO_CONFIRM sin OPTIMIZE_PROGRAMS) - omitiendo"
                $sel = ''
            }
        } else {
            $sel = Read-Host "Ingresa los numeros a deshabilitar (separados por coma, o escribe 'todos')"
        }
        $indices = Parse-IndexSelection -Selection $sel -MaxIndex $entries.Count

        foreach ($idx in $indices) {
            if ($idx -lt 0 -or $idx -ge $entries.Count) { continue }
            $e = $entries[$idx]
            try {
                if ($e.Type -eq "Registry") {
                    if ($e.Source -match 'HKLM' -and -not $isAdmin) {
                        Write-Host "  Omitido (requiere admin): $($e.Name) [$($e.Source)]" -ForegroundColor DarkYellow
                        Write-LogLocal "OMITIDO (admin requerido): $($e.Name) desde $($e.KeyPath)"
                        continue
                    }
                    Remove-ItemProperty -LiteralPath $e.KeyPath -Name $e.Name -Force -ErrorAction Stop
                    Write-Host "  Deshabilitado (registry): $($e.Name)" -ForegroundColor Green
                    Write-LogLocal "Deshabilitado (registry): $($e.Name) desde $($e.KeyPath)"
                } elseif ($e.Type -eq "Shortcut") {
                    $disabledDir = Join-Path (Split-Path $e.KeyPath) "Startup_Disabled"
                    if (-not (Test-Path $disabledDir)) {
                        New-Item -ItemType Directory -Path $disabledDir -Force | Out-Null
                    }
                    $dest = Join-Path $disabledDir (Split-Path $e.KeyPath -Leaf)
                    Move-Item -LiteralPath $e.KeyPath -Destination $dest -Force -ErrorAction Stop
                    Write-Host "  Deshabilitado (shortcut): $($e.Name)" -ForegroundColor Green
                    Write-LogLocal "Deshabilitado (shortcut): $($e.Name) -> $dest"
                }
            } catch {
                Write-Host "  Error deshabilitando $($e.Name): $($_.Exception.Message)" -ForegroundColor Red
                Write-LogLocal "ERROR deshabilitando $($e.Name): $($_.Exception.Message)"
            }
        }
    }
} else {
    Write-Host "`nNo hay programas de inicio detectados." -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════
# 2. Scheduled Tasks at Logon
# ═══════════════════════════════════════════════════
try {
    $allTasks = Get-ScheduledTask -ErrorAction Stop
    $logonTasks = $allTasks | Where-Object {
        $triggers = $_.Triggers
        if (-not $triggers) { return $false }
        $found = $false
        foreach ($t in $triggers) {
            if ($t.CimClass.CimClassName -in @('MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger',
                'MSFT_TaskSessionStateChangeTrigger')) {
                $found = $true
                break
            }
        }
        $found
    }
    $enabledTasks = $logonTasks | Where-Object { $_.State -ne 'Disabled' }

    if ($enabledTasks) {
        $taskArr = @($enabledTasks | Sort-Object TaskPath, TaskName)
        $taskWarning = if (-not $isAdmin) { " [puede requerir admin para tareas de sistema]" } else { "" }
        Write-Host "`n--- Tareas programadas al inicio ($($taskArr.Count) habilitadas)$taskWarning ---" -ForegroundColor Yellow
        for ($i = 0; $i -lt $taskArr.Count; $i++) {
            $trigStr = ($taskArr[$i].Triggers | ForEach-Object {
                $_.CimClass.CimClassName.Replace('MSFT_Task', '').Replace('Trigger', '')
            }) -join ', '
            Write-Host "[$($i + 1)] $($taskArr[$i].TaskPath)$($taskArr[$i].TaskName)  [$trigStr]"
        }

        if (Confirm-Action "Deshabilitar alguna tarea programada?") {
            if ($env:AUTO_CONFIRM -eq 'true') {
                if ($env:OPTIMIZE_TASKS) {
                    $sel = $env:OPTIMIZE_TASKS
                    Write-Host "Seleccion de tareas via env (auto): $sel"
                } else {
                    Write-Host "Sin seleccion de tareas (AUTO_CONFIRM sin OPTIMIZE_TASKS) - omitiendo"
                    $sel = ''
                }
            } else {
                $sel = Read-Host "Ingresa los numeros a deshabilitar (separados por coma, o escribe 'todos')"
            }
            $indices = Parse-IndexSelection -Selection $sel -MaxIndex $taskArr.Count

            foreach ($idx in $indices) {
                if ($idx -lt 0 -or $idx -ge $taskArr.Count) { continue }
                $t = $taskArr[$idx]
                try {
                    Disable-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop
                    Write-Host "  Deshabilitada: $($t.TaskName)" -ForegroundColor Green
                    Write-LogLocal "Tarea deshabilitada: $($t.TaskPath)$($t.TaskName)"
                } catch {
                    Write-Host "  Error deshabilitando $($t.TaskName): $($_.Exception.Message)" -ForegroundColor Red
                    Write-LogLocal "ERROR deshabilitando $($t.TaskName): $($_.Exception.Message)"
                }
            }
        }
    } else {
        Write-Host "`nNo hay tareas de inicio habilitadas." -ForegroundColor Yellow
    }
} catch {
    Write-Host "No se pudieron consultar tareas programadas: $($_.Exception.Message)" -ForegroundColor Red
    Write-LogLocal "ERROR consultando tareas: $($_.Exception.Message)"
}

Write-LogLocal "=== Optimizacion de inicio - fin ==="
Write-Host "`nListo." -ForegroundColor Green
