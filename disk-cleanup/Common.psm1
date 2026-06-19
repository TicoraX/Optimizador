<#
.SYNOPSIS
    Shared helpers for the disk-cleanup scripts.
#>

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Action {
    param([string]$Message)
    if ($env:AUTO_CONFIRM -eq 'true') {
        Write-Host "$Message (auto-confirmado: si)"
        return $true
    }
    if ($host.Name -notmatch 'ConsoleHost') {
        Write-Host "$Message (auto-confirmado: no interactivo)"
        return $true
    }
    $answer = Read-Host "$Message (s/n)"
    return $answer -match '^[sSyY]'
}

function Write-Log {
    param([string]$Message, [string]$LogPath)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Host $line
    if ($LogPath) { Add-Content -Path $LogPath -Value $line }
}

Export-ModuleMember -Function Test-CommandExists, Confirm-Action, Write-Log
