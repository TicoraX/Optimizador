<#
.SYNOPSIS
    Scans for reclaimable disk space (temp files, browser cache, old downloads,
    recycle bin) and writes a Markdown report + sidecar JSON with counts.
    Does NOT delete anything.

.PARAMETER DownloadsAgeDays
    Files in Downloads older than this many days are flagged. Default 30.

.PARAMETER ReportDir
    Directory where the .md and .json reports will be saved. Defaults to ./reports next to this script.
#>

param(
    [int]$DownloadsAgeDays = 30,
    [string]$ReportDir = (Join-Path $PSScriptRoot "reports")
)

# Override via env var para ejecucion no-interactiva desde el backend
if ($env:DOWNLOADS_AGE_DAYS) { $DownloadsAgeDays = [int]$env:DOWNLOADS_AGE_DAYS }

if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd"
$reportPath = Join-Path $ReportDir "cleanup-report-$timestamp.md"
$countsPath = Join-Path $ReportDir "cleanup-counts.json"

function Get-FolderSizeMB {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    try {
        $bytes = (Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue |
                  Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        if (-not $bytes) { return 0 }
        return [math]::Round($bytes / 1MB, 1)
    } catch { return 0 }
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# Reporte de limpieza de disco - $timestamp`n")

# -----------------------------------------------------------
# Windows Temp
# -----------------------------------------------------------
$userTemp = $env:TEMP
$winTemp = "$env:WINDIR\Temp"
$prefetch = "$env:WINDIR\Prefetch"

$userTempMB = Get-FolderSizeMB $userTemp
$winTempMB = Get-FolderSizeMB $winTemp
$prefetchMB = Get-FolderSizeMB $prefetch
$tempTotalMB = $userTempMB + $winTempMB + $prefetchMB

$lines.Add("## Temporales de Windows ($tempTotalMB MB)`n")
$lines.Add("- %TEMP% ($userTemp): $userTempMB MB")
$lines.Add("- Windows\Temp: $winTempMB MB")
$lines.Add("- Prefetch: $prefetchMB MB`n")

# -----------------------------------------------------------
# Browser cache
# -----------------------------------------------------------
$lines.Add("## Cache de navegadores`n")
$browserPaths = @{
    "Chrome"  = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"
    "Edge"    = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache"
    "Firefox" = "$env:APPDATA\Mozilla\Firefox\Profiles"
}
$browserCacheTotalMB = 0
foreach ($browser in $browserPaths.Keys) {
    $path = $browserPaths[$browser]
    $sizeMB = Get-FolderSizeMB $path
    $browserCacheTotalMB += $sizeMB
    if ($sizeMB -gt 0) {
        $lines.Add("- $browser`: $sizeMB MB ($path)")
    }
}
$lines.Add("")

# -----------------------------------------------------------
# Downloads (old files)
# -----------------------------------------------------------
$lines.Add("## Descargas con mas de $DownloadsAgeDays dias`n")
$downloadsPath = Join-Path $env:USERPROFILE "Downloads"
$downloadsCount = 0
$downloadsTotalMB = 0
$downloadsError = $false
if (Test-Path $downloadsPath) {
    $cutoff = (Get-Date).AddDays(-$DownloadsAgeDays)
    $oldFiles = Get-ChildItem -Path $downloadsPath -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt $cutoff }
    if ($oldFiles) {
        $downloadsCount = $oldFiles.Count
        $downloadsTotalMB = [math]::Round((($oldFiles | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
        $lines.Add("Total: $downloadsTotalMB MB en $downloadsCount archivos`n")
        $lines.Add('```')
        foreach ($f in $oldFiles | Sort-Object LastWriteTime) {
            $sizeMB = [math]::Round($f.Length / 1MB, 2)
            $lines.Add("$($f.LastWriteTime.ToString('yyyy-MM-dd'))  $sizeMB MB  $($f.Name)")
        }
        $lines.Add('```')
        $lines.Add("")
    } else {
        $lines.Add("No hay archivos con mas de $DownloadsAgeDays dias.`n")
    }
} else {
    $downloadsError = $true
    $lines.Add("Carpeta de Descargas no encontrada.`n")
}

# -----------------------------------------------------------
# Recycle Bin
# -----------------------------------------------------------
$lines.Add("## Papelera de reciclaje`n")
$recycleCount = 0
$recycleTotalMB = 0
$recycleError = $false
try {
    $shell = New-Object -ComObject Shell.Application
    $recycleBin = $shell.NameSpace(0xa)
    $items = $recycleBin.Items()
    $recycleCount = $items.Count
    foreach ($item in $items) {
        try { $recycleTotalMB += [math]::Round($item.Size / 1MB, 1) } catch {}
    }
    $lines.Add("Elementos en la papelera: $recycleCount ($recycleTotalMB MB)`n")
} catch {
    $recycleError = $true
    $lines.Add("No se pudo leer la papelera de reciclaje.`n")
}

# -----------------------------------------------------------
# Write Markdown
# -----------------------------------------------------------
$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

# -----------------------------------------------------------
# Write sidecar JSON
# -----------------------------------------------------------
@{
    date          = $timestamp
    reportPath    = $reportPath
    temp          = @{ total_mb = $tempTotalMB; error = $false }
    browser_cache = @{ total_mb = $browserCacheTotalMB; error = $false }
    downloads     = @{ total_mb = $downloadsTotalMB; count = $downloadsCount; error = $downloadsError }
    recycle_bin   = @{ total_mb = $recycleTotalMB; count = $recycleCount; error = $recycleError }
} | ConvertTo-Json | Out-File -FilePath $countsPath -Encoding utf8

Write-Output "Reporte generado en: $reportPath"
Write-Output "Conteos generados en: $countsPath"
