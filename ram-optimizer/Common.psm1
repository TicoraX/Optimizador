<#
.SYNOPSIS
    Shared helpers for the ram-optimizer scripts.
#>

$CriticalProcesses = @(
    'System Idle Process', 'System', 'svchost.exe', 'services.exe',
    'wininit.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'smss.exe',
    'spoolsv.exe', 'MsMpEng.exe', 'MsMpEngCp.exe', 'SecurityHealthService.exe',
    'senseir.exe', 'MsSense.exe', 'SearchIndexer.exe', 'SIHClient.exe',
    'conhost.exe', 'dwm.exe', 'explorer.exe', 'RuntimeBroker.exe',
    'sihost.exe', 'taskhostw.exe', 'ctfmon.exe', 'fontdrvhost.exe',
    'LogonUI.exe', 'WmiPrvSE.exe'
)

# No son criticos para Windows, pero terminarlos pierde trabajo/estado del
# usuario (pestañas, sesiones, sincronizacion en curso) sin previo aviso.
# Se muestran aparte y nunca se incluyen como "seguro de liberar".
$RiskyProcesses = @(
    'Code.exe', 'OpenCode.exe', 'claude.exe', 'devenv.exe', 'idea64.exe',
    'pycharm64.exe', 'WindowsTerminal.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe',
    'brave.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe',
    'OneDrive.exe', 'Dropbox.exe', 'GoogleDriveFS.exe',
    'Discord.exe', 'Slack.exe', 'Teams.exe', 'ms-teams.exe', 'Outlook.exe', 'Thunderbird.exe',
    'Docker Desktop.exe', 'com.docker.backend.exe', 'vmware.exe', 'VirtualBox.exe',
    'KeePass.exe', 'KeePassXC.exe', '1Password.exe'
)

$KnownProcesses = @{
    'Memory Compression.exe'     = 'Compresor de memoria de Windows'
    'Memory Compression'         = 'Compresor de memoria de Windows'
    'Registry.exe'               = 'Registro del sistema'
    'Registry'                   = 'Registro del sistema'
    'Secure System.exe'          = 'Proceso seguro del sistema'
    'Secure System'              = 'Proceso seguro del sistema'
    'audiodg.exe'                = 'Grafico de audio de Windows'
    'backgroundTaskHost.exe'     = 'Host de tareas en segundo plano'
    'CompPkgSrv.exe'             = 'Servicio de paquetes de componentes'
    'dasHost.exe'                = 'Host de asociacion de dispositivos'
    'mDNSResponder.exe'          = 'Bonjour (multicast DNS)'
    'nsi.exe'                    = 'Interfaz de servicios de red'
    'smartscreen.exe'            = 'Filtro de SmartScreen'
    'SpeechRuntime.exe'          = 'Tiempo de ejecucion de voz'
    'tiledatamodelsvc.exe'       = 'Servicio de modelos de datos'
    'TimeBrokerSrv.exe'          = 'Servicio de broker de tiempo'
    'UsoSvc.exe'                 = 'Servicio de sesion de actualizacion'
    'VSSVC.exe'                  = 'Servicio de copias de sombra'
    'waasmedic.exe'              = 'Asistente de Windows Update'
    'WpnService.exe'             = 'Servicio de notificaciones push'
    'WpnUserService.exe'         = 'Servicio de notificaciones de usuario'
    'TabSvc.exe'                 = 'Servicio de texto a voz'
    'wlms.exe'                   = 'Administrador de licencias de Windows'
    'UserOOBEBroker.exe'         = 'Configuracion posterior a instalacion'
    'NisSrv.exe'                 = 'Inspeccion de red de Defender'
    'SgrmBroker.exe'             = 'Broker de seguridad del sistema'
    'NVIDIA Overlay.exe'         = 'Superposicion NVIDIA'
    'nvcontainer.exe'            = 'Contenedor NVIDIA'
    'nvtray.exe'                 = 'Bandeja NVIDIA'
    'radeonsoftware.exe'         = 'Software AMD Radeon'
    'lghub_agent.exe'            = 'Agente Logitech G Hub'
    'lghub_updater.exe'          = 'Actualizador Logitech'
    'steamwebhelper.exe'         = 'Asistente web Steam'
    'SteamService.exe'           = 'Servicio Steam'
    'RtkAudUService.exe'         = 'Audio Realtek'
    'ShellExperienceHost.exe'    = 'Interfaz de inicio de Windows'
    'SearchApp.exe'              = 'Busqueda de Windows'
    'widgets.exe'                = 'Widgets de Windows'
    'WidgetService.exe'          = 'Servicio de Widgets'
    'GameBar.exe'                = 'Barra de juego de Windows'
    'GameBarPresenceWriter.exe'  = 'Presencia de juego'
    'PhoneExperienceHost.exe'    = 'Experiencia de telefono'
    'OfficeClickToRun.exe'       = 'Microsoft Office'
    'AdobeIPCBroker.exe'         = 'Broker de IPC de Adobe'
    'CCLibrary.exe'              = 'Biblioteca Creative Cloud'
    'Creative Cloud.exe'         = 'Adobe Creative Cloud'
    'CoreSync.exe'               = 'Sincronizacion de Adobe'
    # 'node.exe' deliberadamente NO esta aqui: es un nombre generico que usa
    # cualquier programa basado en Node (servidores de desarrollo, extensiones,
    # CLIs), no solo este dashboard. Cae en 'unknown' (seleccion manual).
    'ollama app.exe'             = 'Ollama (IA local)'
    'OneDrive.Sync.Service.exe'  = 'Sincronizacion de OneDrive'
    'SearchProtocolHost.exe'     = 'Host de busqueda'
    'SearchFilterHost.exe'       = 'Filtro de busqueda'
}

function Get-ProcessTier {
    <#
    .SYNOPSIS
        Clasifica un proceso en 'critical' / 'risky' / 'safe_known' / 'unknown'.
    .DESCRIPTION
        HasWindow (ventana visible, via MainWindowTitle) es la señal generica:
        no depende de que app sea ni de quien la use. RiskyProcesses respalda
        apps con estado valioso sin ventana visible. KnownProcesses identifica
        procesos de segundo plano conocidos. El resto es 'unknown'.
    #>
    param([string]$Name, [bool]$HasWindow = $false)
    if ($Name -in $CriticalProcesses) { return 'critical' }
    if ($HasWindow -or $Name -in $RiskyProcesses) { return 'risky' }
    if ($KnownProcesses.ContainsKey($Name)) { return 'safe_known' }
    return 'unknown'
}

function Get-ProcessDescription {
    <#
    .SYNOPSIS
        Retorna la descripcion legible de un proceso, o $null si no esta en KnownProcesses.
    #>
    param([string]$Name)
    if ($KnownProcesses.ContainsKey($Name)) { return $KnownProcesses[$Name] }
    return $null
}

<#
.SYNOPSIS
    PIDs propios del proceso actual y sus ancestros (terminal, shell, etc.) - nunca tocar.
#>
function Get-ProtectedPids {
    $protectedIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$protectedIds.Add($PID)
    try {
        $cur = $PID
        $seen = [System.Collections.Generic.HashSet[int]]::new()
        while ($true) {
            if ($seen.Contains($cur)) { break }
            [void]$seen.Add($cur)
            $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $cur" -ErrorAction SilentlyContinue
            if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
            $cur = $proc.ParentProcessId
            if ($protectedIds.Contains($cur)) { break }
            [void]$protectedIds.Add($cur)
        }
    } catch {}
    return $protectedIds
}

$D1MemoryPurgeSrc = @"
using System;
using System.Runtime.InteropServices;
public class D1MemoryPurge {
    [DllImport("ntdll.dll")]
    public static extern int NtSetSystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength);
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);
    [StructLayout(LayoutKind.Sequential)]
    public struct TokPriv1Luid { public int Count; public long Luid; public int Attr; }
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TokPriv1Luid NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);
    const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    const uint TOKEN_QUERY = 0x0008;
    const int SE_PRIVILEGE_ENABLED = 0x00000002;
    const int ERROR_NOT_ALL_ASSIGNED = 1300;
    // ponytail: AdjustTokenPrivileges puede devolver exito sin asignar nada - hay que
    // chequear GetLastError para saber si el token REALMENTE tenia el privilegio.
    static bool EnablePrivilege(string privilege) {
        IntPtr hToken;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out hToken)) return false;
        TokPriv1Luid tp;
        tp.Count = 1;
        tp.Attr = SE_PRIVILEGE_ENABLED;
        if (!LookupPrivilegeValue(null, privilege, out tp.Luid)) return false;
        bool ok = AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
        return ok && Marshal.GetLastWin32Error() != ERROR_NOT_ALL_ASSIGNED;
    }
    public static bool LastPrivOk1, LastPrivOk2;
    public static int PurgeStandbyList() {
        LastPrivOk1 = EnablePrivilege("SeProfileSingleProcessPrivilege");
        LastPrivOk2 = EnablePrivilege("SeIncreaseQuotaPrivilege");
        IntPtr ptr = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(ptr, 4); // MemoryPurgeStandbyList
        try {
            return NtSetSystemInformation(80, ptr, 4); // SystemMemoryListInformation
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
    }
}
"@

<#
.SYNOPSIS
    Vacia de verdad la "standby list" de Windows (misma tecnica que
    RAMMap/EmptyStandbyList.exe de Sysinternals) - a diferencia de
    EmptyWorkingSet, esto SI baja el % de "RAM en uso" reportado por el
    sistema. No toca ningun proceso, solo cache de memoria. Requiere
    administrador; si no hay privilegios devuelve $false sin intentar nada.
.OUTPUTS
    [bool] $true si NTSTATUS fue 0 (exito).
#>
function Clear-StandbyList {
    try {
        if (-not ([System.Management.Automation.PSTypeName]'D1MemoryPurge').Type) {
            Add-Type -TypeDefinition $D1MemoryPurgeSrc -Language CSharp
        }
        $status = [D1MemoryPurge]::PurgeStandbyList()
        if ($status -ne 0 -and (-not [D1MemoryPurge]::LastPrivOk1 -or -not [D1MemoryPurge]::LastPrivOk2)) {
            Write-Host "  (el token de administrador no tiene SeProfileSingleProcessPrivilege/SeIncreaseQuotaPrivilege - revisa la directiva de seguridad local)" -ForegroundColor DarkYellow
        }
        return ($status -eq 0)
    } catch {
        return $false
    }
}

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

Export-ModuleMember -Function Test-CommandExists, Confirm-Action, Write-Log, Get-ProcessTier, Get-ProcessDescription, Get-ProtectedPids, Clear-StandbyList -Variable CriticalProcesses, RiskyProcesses, KnownProcesses
