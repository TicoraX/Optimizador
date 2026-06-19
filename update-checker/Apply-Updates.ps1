<#
.SYNOPSIS
    Interactively applies updates, asking per category (winget, pip, npm, choco)
    before running any install command. Meant to be run manually or launched
    from the weekly notification.

.PARAMETER LogDir
    Directory where the run log is appended. Defaults to ./reports next to this script.
#>

param(
    [string]$LogDir = (Join-Path $PSScriptRoot "reports")
)

Import-Module (Join-Path $PSScriptRoot "Common.psm1") -Force

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logPath = Join-Path $LogDir "apply-log.txt"

function Write-Log {
    param([string]$Message)
    Common\Write-Log -Message $Message -LogPath $logPath
}

Write-Log "=== Aplicar actualizaciones - inicio ==="

if (Test-CommandExists "winget") {
    if (Confirm-Action "Actualizar apps/drivers via winget?") {
        try {
            winget upgrade --all --include-unknown --disable-interactivity --accept-source-agreements --accept-package-agreements
            Write-Log "winget upgrade --all completado."
        } catch {
            Write-Log "winget upgrade fallo: $($_.Exception.Message)"
        }
    }
} else {
    Write-Log "winget no disponible, se omite."
}

if (Test-CommandExists "pip") {
    if (Confirm-Action "Actualizar paquetes pip desactualizados?") {
        try {
            $pipJson = (pip list --outdated --format=json 2>$null) -join "`n"
            $pipParsed = $pipJson | ConvertFrom-Json
            $outdated = if ($pipParsed -is [array]) { $pipParsed } else { @($pipParsed) }
            if ($outdated.Count -eq 0) {
                Write-Log "No hay paquetes pip desactualizados."
            } else {
                $succeeded = [System.Collections.Generic.List[string]]::new()
                $failed = [System.Collections.Generic.List[string]]::new()
                foreach ($pkg in $outdated) {
                    Write-Host "Instalando $($pkg.name)..." -ForegroundColor Yellow
                    pip install -U $pkg.name
                    if ($LASTEXITCODE -eq 0) {
                        $succeeded.Add($pkg.name)
                    } else {
                        $failed.Add($pkg.name)
                    }
                }
                Write-Log "pip install -U OK: $($succeeded -join ', ')"
                if ($failed.Count -gt 0) {
                    Write-Log "pip install -U FALLO en: $($failed -join ', ')"
                }
            }
        } catch {
            Write-Log "pip update fallo: $($_.Exception.Message)"
        }
    }
} else {
    Write-Log "pip no disponible, se omite."
}

if (Test-CommandExists "npm") {
    if (Confirm-Action "Actualizar paquetes npm globales?") {
        try {
            npm update -g
            Write-Log "npm update -g completado."
        } catch {
            Write-Log "npm update fallo: $($_.Exception.Message)"
        }
    }
} else {
    Write-Log "npm no disponible, se omite."
}

if (Test-CommandExists "choco") {
    if (Confirm-Action "Actualizar paquetes choco?") {
        try {
            choco upgrade all -y --no-color
            Write-Log "choco upgrade all completado."
        } catch {
            Write-Log "choco upgrade fallo: $($_.Exception.Message)"
        }
    }
} else {
    Write-Log "Chocolatey no disponible, se omite."
}

Write-Log "=== Aplicar actualizaciones - fin ==="
