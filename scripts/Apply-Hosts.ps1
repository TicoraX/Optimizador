<#
.SYNOPSIS
    Aplica o quita el bloqueo de dominios en el archivo hosts de Windows.

.DESCRIPTION
    Es la unica parte del Optimizador que corre elevada, asi que hace lo minimo
    posible y no confia en su entrada.

    Escribe SOLO entre dos marcadores propios. Todo lo que este fuera de ese
    bloque (incluidas las entradas que el usuario haya puesto a mano) se copia
    tal cual. Quitar el bloqueo es borrar el bloque, nunca reescribir el archivo
    con una plantilla.

    Cada dominio del archivo de lista se valida contra un regex estricto antes
    de escribirse: la lista se descarga de internet, asi que se trata como
    entrada hostil. Una linea que no sea un dominio valido se descarta, no se
    escribe "por las dudas".

.PARAMETER ListFile
    Archivo de texto con un dominio por linea. Solo se lee.

.PARAMETER Action
    apply: reemplaza el bloque con los dominios de ListFile.
    remove: borra el bloque y deja el hosts como estaba antes.

.PARAMETER BackupDir
    Carpeta donde dejar una copia del hosts previo a modificarlo.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('apply', 'remove')][string]$Action,
    [string]$ListFile,
    [Parameter(Mandatory = $true)][string]$BackupDir
)

$ErrorActionPreference = 'Stop'

$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$marcaInicio = '# === OPTIMIZADOR ADBLOCK INICIO (no editar a mano) ==='
$marcaFin = '# === OPTIMIZADOR ADBLOCK FIN ==='

# Dominios que nunca se bloquean, aunque aparezcan en la lista descargada.
# Mismo criterio que la lista de servicios protegidos: una lista de terceros no
# puede dejar al equipo sin Windows Update ni sin poder iniciar sesion.
$nuncaBloquear = @(
    'localhost', 'microsoft.com', 'windowsupdate.com', 'update.microsoft.com',
    'live.com', 'login.microsoftonline.com', 'msftconnecttest.com',
    'riotgames.com', 'riotcdn.net', 'cloudflare.com', 'github.com'
)

# Un dominio y nada mas: sin espacios, sin rutas, sin caracteres de control.
# Es lo que impide que una linea de la lista inyecte otra cosa en el hosts.
#
# El ultimo tramo tiene que ser alfabetico. Sin eso una linea suelta `0.0.0.0`
# (las fuentes las traen) pasa como dominio valido: ningun TLD real es numerico.
$regexDominio = '^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$'
$maxDominios = 300000

function Get-DominiosValidos([string]$ruta) {
    if (-not (Test-Path -LiteralPath $ruta -PathType Leaf)) {
        throw "No existe el archivo de lista: $ruta"
    }
    $vistos = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($linea in [System.IO.File]::ReadLines($ruta)) {
        $d = $linea.Trim().ToLowerInvariant()
        if ($d -eq '' -or $d.StartsWith('#')) { continue }
        if ($d.Length -gt 253 -or $d -notmatch $regexDominio) { continue }
        $protegido = $false
        foreach ($p in $nuncaBloquear) {
            if ($d -eq $p -or $d.EndsWith(".$p")) { $protegido = $true; break }
        }
        if ($protegido) { continue }
        [void]$vistos.Add($d)
        if ($vistos.Count -ge $maxDominios) { break }
    }
    return , $vistos
}

$lineas = [System.IO.File]::ReadAllLines($hostsPath)

# Copia de seguridad antes de tocar nada. Con marca de tiempo: no se pisa.
if (-not (Test-Path -LiteralPath $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}
$backup = Join-Path $BackupDir ("hosts.bak-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
[System.IO.File]::Copy($hostsPath, $backup, $true)

# Conservar todo lo que este fuera del bloque propio.
$fuera = [System.Collections.Generic.List[string]]::new()
$dentro = $false
foreach ($l in $lineas) {
    if ($l.Trim() -eq $marcaInicio) { $dentro = $true; continue }
    if ($l.Trim() -eq $marcaFin) { $dentro = $false; continue }
    if (-not $dentro) { $fuera.Add($l) }
}

# Sin lineas en blanco de sobra al final del tramo conservado.
while ($fuera.Count -gt 0 -and $fuera[$fuera.Count - 1].Trim() -eq '') {
    $fuera.RemoveAt($fuera.Count - 1)
}

$salida = [System.Collections.Generic.List[string]]::new($fuera)
$escritos = 0

if ($Action -eq 'apply') {
    if (-not $ListFile) { throw 'apply requiere -ListFile' }
    $dominios = Get-DominiosValidos $ListFile
    $escritos = $dominios.Count
    $salida.Add('')
    $salida.Add($marcaInicio)
    $salida.Add("# Generado el $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). $escritos dominios.")
    $salida.Add('# Para quitarlo, usa el modulo Anuncios del Optimizador.')
    foreach ($d in $dominios) { $salida.Add("0.0.0.0 $d") }
    $salida.Add($marcaFin)
}

# UTF8 sin BOM: el resolutor de Windows no lee un hosts con BOM.
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($hostsPath, $salida, $enc)

# La cache del cliente DNS mantiene lo viejo hasta que se vacia.
ipconfig /flushdns | Out-Null

Write-Output "OK $Action $escritos $backup"
