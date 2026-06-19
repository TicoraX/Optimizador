<#
.SYNOPSIS
    Scans startup configuration (registry programs, boot performance, auto-start
    services, logon tasks) and writes a Markdown report + sidecar JSON with counts
    + boot history. Does NOT modify anything.

.PARAMETER ReportDir
    Directory where reports are saved. Defaults to ./reports next to this script.
#>

param(
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "startup-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "startup-counts.json"
$bootHistoryPath = Join-Path $ReportDir "boot-history.json"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de optimizacion de inicio - $timestamp")
$lines.Add("")

# ──────────────────────────────────────────────────────
# Startup Programs (Registry + Startup folders)
# ──────────────────────────────────────────────────────
$startupEntries = [System.Collections.Generic.List[PSCustomObject]]::new()
$startupError = $false

$regPaths = @(
    @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKCU)" }
    @{ Path = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKLM)" }
    @{ Path = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"; Label = "Registro (HKLM 32-bit)" }
)

foreach ($rp in $regPaths) {
    try {
        if (Test-Path $rp.Path) {
            $props = Get-ItemProperty -LiteralPath $rp.Path -ErrorAction Stop
            $propNames = $props.PSObject.Properties |
                Where-Object { $_.Name -notin @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider') }
            foreach ($pn in $propNames) {
                $startupEntries.Add([PSCustomObject]@{
                    Name    = $pn.Name
                    Command = $pn.Value
                    Source  = $rp.Label
                    KeyPath = $rp.Path
                })
            }
        }
    } catch {
        $startupError = $true
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
                $startupEntries.Add([PSCustomObject]@{
                    Name    = $sc.BaseName
                    Command = $target
                    Source  = $sf.Label
                    KeyPath = $sc.FullName
                })
            } catch {
                $startupEntries.Add([PSCustomObject]@{
                    Name    = $sc.BaseName
                    Command = "no se pudo leer destino"
                    Source  = $sf.Label
                    KeyPath = $sc.FullName
                })
            }
        }
    }
}
$startupCount = $startupEntries.Count

$lines.Add("## Resumen")
$lines.Add("")
$lines.Add("- Programas de inicio: $startupCount entradas")

# ──────────────────────────────────────────────────────
# Boot Performance (EventLog ID 100)
# ──────────────────────────────────────────────────────
$bootError = $false
$bootTimeMs = 0
$trend = "unknown"

try {
    $bootEvents = Get-WinEvent -FilterHashtable @{
        LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'
        ID      = 100
    } -MaxEvents 5 -ErrorAction Stop

    if ($bootEvents) {
        $bootTimes = @()
        foreach ($event in $bootEvents) {
            if ($event.Message -match 'Boot Duration\s*:\s*(\d+)ms') {
                $bootTimes += [int]$matches[1]
            } elseif ($event.Message -match 'MainPathBootTime\s*:\s*(\d+)') {
                $bootTimes += [int]$matches[1]
            }
        }
        if ($bootTimes.Count -gt 0) {
            $avgBootMs = [math]::Round(($bootTimes | Measure-Object -Average).Average, 0)
            $bootTimeMs = $avgBootMs

            $bootHistory = @()
            if (Test-Path $bootHistoryPath) {
                $raw = Get-Content $bootHistoryPath -Raw
                if ($raw) {
                    $parsed = $raw | ConvertFrom-Json
                    if ($parsed -is [array]) { $bootHistory = $parsed }
                    else { $bootHistory = @($parsed) }
                }
            }
            $bootHistory += [PSCustomObject]@{ date = $timestamp; boot_time_ms = $avgBootMs }
            $bootHistory | ConvertTo-Json | Out-File -FilePath $bootHistoryPath -Encoding utf8

            if ($bootHistory.Count -ge 2) {
                $prev = $bootHistory[$bootHistory.Count - 2].boot_time_ms
                if ($avgBootMs -gt ($prev * 1.1)) { $trend = "slower" }
                elseif ($avgBootMs -lt ($prev * 0.9)) { $trend = "faster" }
                else { $trend = "stable" }
            } else {
                $trend = "first-scan"
            }

            $lines.Add("- Rendimiento de arranque: $avgBootMs ms (tendencia: $trend)")
        } else {
            $lines.Add("- Rendimiento de arranque: no se pudo extraer tiempo")
        }
    } else {
        $lines.Add("- Rendimiento de arranque: sin eventos ID 100")
    }
} catch {
    $bootError = $true
    $lines.Add("- Rendimiento de arranque: error")
}

# ──────────────────────────────────────────────────────
# Auto-starting Services
# ──────────────────────────────────────────────────────
$servicesCount = 0
$servicesError = $false
$nonMsCount = 0

try {
    $services = Get-CimInstance -ClassName Win32_Service -ErrorAction Stop |
        Where-Object { $_.StartMode -eq 'Auto' }
    if ($services) {
        $servicesCount = $services.Count
        $nonMs = $services | Where-Object {
            $path = $_.PathName
            $path -and $path -notmatch '\\Windows\\' -and $path -notmatch '\\System32\\drivers\\'
        }
        $nonMsCount = $nonMs.Count
    }
    $lines.Add("- Servicios auto-start: $servicesCount ($nonMsCount no-Microsoft)")
} catch {
    $servicesError = $true
    $lines.Add("- Servicios auto-start: error")
}

# ──────────────────────────────────────────────────────
# Scheduled Tasks at Logon/Startup
# ──────────────────────────────────────────────────────
$logonTasksCount = 0
$logonTasksError = $false
$logonTaskList = @()
$enabledCount = 0

try {
    $allTasks = Get-ScheduledTask -ErrorAction Stop
    $logonTasks = $allTasks | Where-Object {
        $triggers = $_.Triggers
        if (-not $triggers) { return $false }
        $found = $false
        foreach ($t in $triggers) {
            $className = $t.CimClass.CimClassName
            if ($className -in @('MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger',
                'MSFT_TaskSessionStateChangeTrigger')) {
                $found = $true
                break
            }
        }
        $found
    }
    if ($logonTasks) {
        $logonTasksCount = $logonTasks.Count
        $enabledTasks = $logonTasks | Where-Object { $_.State -ne 'Disabled' }
        $enabledCount = $enabledTasks.Count
    }
    $lines.Add("- Tareas programadas al inicio/logon: $logonTasksCount ($enabledCount habilitadas)")
} catch {
    $logonTasksError = $true
    $lines.Add("- Tareas programadas al inicio/logon: error")
}

# ──────────────────────────────────────────────────────
# Detail sections
# ──────────────────────────────────────────────────────
$lines.Add("")
$lines.Add("## Programas de inicio ($startupCount)")
$lines.Add("")

if ($startupCount -gt 0) {
    $lines.Add('```')
    foreach ($e in $startupEntries) {
        $lines.Add("[$($e.Source)]  $($e.Name)")
        $lines.Add("  Comando: $($e.Command)")
        $lines.Add("")
    }
    $lines.Add('```')
} else {
    $lines.Add("No hay programas registrados para iniciar automaticamente.")
}
$lines.Add("")

$lines.Add("## Rendimiento de arranque")
$lines.Add("")

if (-not $bootError) {
    try {
        $bootEvents = Get-WinEvent -FilterHashtable @{
            LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'
            ID      = 100
        } -MaxEvents 5 -ErrorAction Stop
        if ($bootEvents) {
            $lines.Add('```')
            foreach ($event in $bootEvents) {
                $lines.Add("$($event.TimeCreated): $($event.Id) - $($event.Message)")
                $lines.Add("---")
            }
            $lines.Add('```')
        } else {
            $lines.Add("No se encontraron eventos ID 100 en Diagnostics-Performance/Operational.")
        }
    } catch {
        $lines.Add("Error al leer eventos de arranque: $($_.Exception.Message)")
    }
} else {
    $lines.Add("Error al leer eventos de arranque.")
}
$lines.Add("")

$lines.Add("## Servicios auto-start ($servicesCount)")
$lines.Add("")

if (-not $servicesError) {
    try {
        $services = Get-CimInstance -ClassName Win32_Service -ErrorAction Stop |
            Where-Object { $_.StartMode -eq 'Auto' } | Sort-Object Name
        $nonMs = $services | Where-Object {
            $path = $_.PathName
            $path -and $path -notmatch '\\Windows\\' -and $path -notmatch '\\System32\\drivers\\'
        }
        $msServices = $services | Where-Object {
            $path = $_.PathName
            (-not $path) -or $path -match '\\Windows\\' -or $path -match '\\System32\\drivers\\'
        }

        if ($nonMs) {
            $lines.Add("### No-Microsoft ($($nonMs.Count))`n")
            $lines.Add('```')
            foreach ($s in $nonMs) {
                $lines.Add("$($s.Name)  ($($s.DisplayName))")
            }
            $lines.Add('```')
            $lines.Add("")
        }
        if ($msServices) {
            $lines.Add("### Servicios del sistema ($($msServices.Count))")
            $lines.Add("(No se listan por brevedad; son servicios propios de Windows.)")
        }
    } catch {
        $lines.Add("Error al consultar servicios: $($_.Exception.Message)")
    }
} else {
    $lines.Add("No se pudieron consultar los servicios.")
}
$lines.Add("")

$lines.Add("## Tareas programadas al inicio/logon ($logonTasksCount)")
$lines.Add("")

if (-not $logonTasksError) {
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
        if ($logonTasks) {
            $enabledTasks = $logonTasks | Where-Object { $_.State -ne 'Disabled' } | Sort-Object TaskPath, TaskName
            $disabledTasks = $logonTasks | Where-Object { $_.State -eq 'Disabled' } | Sort-Object TaskPath, TaskName

            if ($enabledTasks) {
                $lines.Add("### Habilitadas ($($enabledTasks.Count))`n")
                $lines.Add('```')
                foreach ($t in $enabledTasks) {
                    $trigStr = ($t.Triggers | ForEach-Object {
                        $_.CimClass.CimClassName.Replace('MSFT_Task', '').Replace('Trigger', '')
                    }) -join ', '
                    $lines.Add("$($t.TaskPath)$($t.TaskName)  [$trigStr]")
                }
                $lines.Add('```')
                $lines.Add("")
            }
            if ($disabledTasks) {
                $lines.Add("### Deshabilitadas ($($disabledTasks.Count))`n")
                $lines.Add('```')
                foreach ($t in $disabledTasks) {
                    $trigStr = ($t.Triggers | ForEach-Object {
                        $_.CimClass.CimClassName.Replace('MSFT_Task', '').Replace('Trigger', '')
                    }) -join ', '
                    $lines.Add("$($t.TaskPath)$($t.TaskName)  [$trigStr]")
                }
                $lines.Add('```')
            }
        } else {
            $lines.Add("No hay tareas programadas con trigger de inicio/logon.")
        }
    } catch {
        $lines.Add("Error al consultar tareas: $($_.Exception.Message)")
    }
} else {
    $lines.Add("No se pudieron consultar las tareas programadas.")
}

$lines.Add("")

# ──────────────────────────────────────────────────────
# Write files
# ──────────────────────────────────────────────────────
$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

@{
    date             = $timestamp
    reportPath       = $reportPath
    startup_programs = @{ count = $startupCount; error = $startupError }
    boot_performance = @{ boot_time_ms = $bootTimeMs; trend = $trend; error = $bootError }
    auto_services    = @{ count = $servicesCount; error = $servicesError }
    logon_tasks      = @{ count = $logonTasksCount; enabled = $enabledCount; error = $logonTasksError }
} | ConvertTo-Json -Depth 3 | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
Write-Output "Conteos generados en: $countsPath"
