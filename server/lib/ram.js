import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MODULES, spawnCapture, isAdminWindows, parseCsvLine } from './shared.js';

// ═══════════════════════════════════════════════════════
// RAM optimizer — ejecucion nativa en Node (sin powershell.exe)
//
// Escanea procesos por uso de memoria (tasklist) y RAM total/libre (wmic).
// La accion mata procesos seleccionados con taskkill, omitiendo procesos
// criticos del sistema.
// ═══════════════════════════════════════════════════════

// Script de PowerShell embebido (una sola invocacion -Command, igual al
// patron ya usado para EmptyWorkingSet mas abajo) que llama a la API nativa
// NtSetSystemInformation(SystemMemoryListInformation=80, MemoryPurgeStandbyList=4)
// para vaciar de verdad la "standby list" de Windows - la misma tecnica que
// usa RAMMap/EmptyStandbyList.exe de Sysinternals. A diferencia de
// EmptyWorkingSet (que solo mueve paginas de un proceso a standby),
// esto SI reduce el "RAM en uso" reportado por el sistema.
//
// No toca ningun proceso - es pura limpieza de cache de memoria, por eso es
// seguro de correr sin pedir seleccion de procesos. Requiere permisos de
// administrador (SeProfileSingleProcessPrivilege/SeIncreaseQuotaPrivilege);
// si el proceso del servidor no corre elevado, NtSetSystemInformation
// devuelve STATUS_PRIVILEGE_NOT_HELD y no se intenta nada destructivo.
const PURGE_STANDBY_LIST_SCRIPT = `
$src = @"
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
    // ponytail: devuelve si el token REALMENTE tenia el privilegio (AdjustTokenPrivileges
    // puede devolver exito y no asignar nada - hay que chequear GetLastError igual).
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
    public static string PurgeStandbyListDiag() {
        bool p1 = EnablePrivilege("SeProfileSingleProcessPrivilege");
        bool p2 = EnablePrivilege("SeIncreaseQuotaPrivilege");
        IntPtr ptr = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(ptr, 4); // MemoryPurgeStandbyList
        int status;
        try {
            status = NtSetSystemInformation(80, ptr, 4); // SystemMemoryListInformation
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
        return status + "|" + p1 + "|" + p2;
    }
}
"@
Add-Type -TypeDefinition $src -Language CSharp
Write-Output ("NTSTATUS:" + [D1MemoryPurge]::PurgeStandbyListDiag())
`;

const CRITICAL_PROCESSES = [
  'System Idle Process', 'System', 'svchost.exe', 'services.exe',
  'wininit.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'smss.exe',
  'spoolsv.exe', 'MsMpEng.exe', 'MsMpEngCp.exe', 'SecurityHealthService.exe',
  'senseir.exe', 'MsSense.exe', 'SearchIndexer.exe', 'SIHClient.exe',
  'conhost.exe', 'dwm.exe', 'explorer.exe', 'RuntimeBroker.exe',
  'sihost.exe', 'taskhostw.exe', 'ctfmon.exe', 'fontdrvhost.exe',
  'LogonUI.exe', 'WmiPrvSE.exe',
];

// No son criticos para Windows, pero terminarlos pierde trabajo/estado del
// usuario (pestañas, sesiones, sincronizacion en curso) sin previo aviso.
// Se muestran aparte y NUNCA se incluyen en "seguro de liberar" ni en
// "Seleccionar todos" del dashboard - el usuario debe elegirlos a mano.
const RISKY_PROCESSES = [
  'Code.exe', 'OpenCode.exe', 'claude.exe', 'devenv.exe', 'idea64.exe',
  'pycharm64.exe', 'WindowsTerminal.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe',
  'brave.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe',
  'OneDrive.exe', 'Dropbox.exe', 'GoogleDriveFS.exe',
  'Discord.exe', 'Slack.exe', 'Teams.exe', 'ms-teams.exe', 'Outlook.exe', 'Thunderbird.exe',
  'Docker Desktop.exe', 'com.docker.backend.exe', 'vmware.exe', 'VirtualBox.exe',
  'KeePass.exe', 'KeePassXC.exe', '1Password.exe',
];

// Diccionario nombre → descripcion legible para humanos. Procesos sin ventana
// que esten aqui se clasifican 'safe_known' (identificados, seguros de liberar).
// Los que no esten en critical/risky/known se clasifican 'unknown' (no
// identificados, el usuario los libera bajo su criterio).
const KNOWN_PROCESSES = {
  'Memory Compression.exe': 'Compresor de memoria de Windows',
  'Memory Compression': 'Compresor de memoria de Windows',
  'Registry.exe': 'Registro del sistema',
  'Registry': 'Registro del sistema',
  'Secure System.exe': 'Proceso seguro del sistema',
  'Secure System': 'Proceso seguro del sistema',
  'audiodg.exe': 'Grafico de audio de Windows',
  'backgroundTaskHost.exe': 'Host de tareas en segundo plano',
  'CompPkgSrv.exe': 'Servicio de paquetes de componentes',
  'dasHost.exe': 'Host de asociacion de dispositivos',
  'mDNSResponder.exe': 'Bonjour (multicast DNS)',
  'nsi.exe': 'Interfaz de servicios de red',
  'smartscreen.exe': 'Filtro de SmartScreen',
  'SpeechRuntime.exe': 'Tiempo de ejecucion de voz',
  'tiledatamodelsvc.exe': 'Servicio de modelos de datos',
  'TimeBrokerSrv.exe': 'Servicio de broker de tiempo',
  'UsoSvc.exe': 'Servicio de sesion de actualizacion',
  'VSSVC.exe': 'Servicio de copias de sombra',
  'waasmedic.exe': 'Asistente de Windows Update',
  'WpnService.exe': 'Servicio de notificaciones push',
  'WpnUserService.exe': 'Servicio de notificaciones de usuario',
  'TabSvc.exe': 'Servicio de texto a voz',
  'wlms.exe': 'Administrador de licencias de Windows',
  'UserOOBEBroker.exe': 'Configuracion posterior a instalacion',
  'NisSrv.exe': 'Inspeccion de red de Defender',
  'SgrmBroker.exe': 'Broker de seguridad del sistema',
  'NVIDIA Overlay.exe': 'Superposicion NVIDIA',
  'nvcontainer.exe': 'Contenedor NVIDIA',
  'nvtray.exe': 'Bandeja NVIDIA',
  'radeonsoftware.exe': 'Software AMD Radeon',
  'lghub_agent.exe': 'Agente Logitech G Hub',
  'lghub_updater.exe': 'Actualizador Logitech',
  'steamwebhelper.exe': 'Asistente web Steam',
  'SteamService.exe': 'Servicio Steam',
  'RtkAudUService.exe': 'Audio Realtek',
  'ShellExperienceHost.exe': 'Interfaz de inicio de Windows',
  'SearchApp.exe': 'Busqueda de Windows',
  'widgets.exe': 'Widgets de Windows',
  'WidgetService.exe': 'Servicio de Widgets',
  'GameBar.exe': 'Barra de juego de Windows',
  'GameBarPresenceWriter.exe': 'Presencia de juego',
  'PhoneExperienceHost.exe': 'Experiencia de telefono',
  'OfficeClickToRun.exe': 'Microsoft Office',
  'AdobeIPCBroker.exe': 'Broker de IPC de Adobe',
  'CCLibrary.exe': 'Biblioteca Creative Cloud',
  'Creative Cloud.exe': 'Adobe Creative Cloud',
  'CoreSync.exe': 'Sincronizacion de Adobe',
  // 'node.exe' deliberadamente NO esta aqui: es un nombre generico que usa
  // cualquier programa basado en Node (servidores de desarrollo, extensiones,
  // CLIs), no solo este dashboard. Verlo en la lista no le dice al usuario
  // que proceso es realmente, asi que cae en 'unknown' (seleccion manual).
  'ollama app.exe': 'Ollama (IA local)',
  'OneDrive.Sync.Service.exe': 'Sincronizacion de OneDrive',
  'SearchProtocolHost.exe': 'Host de busqueda',
  'SearchFilterHost.exe': 'Filtro de busqueda',
};

// Lookups insensibles a mayusculas (tasklist no garantiza el casing exacto
// del .exe original) - construidos una sola vez a partir de las listas/dict de arriba.
const CRITICAL_SET_LOWER = new Set(CRITICAL_PROCESSES.map((n) => n.toLowerCase()));
const RISKY_SET_LOWER = new Set(RISKY_PROCESSES.map((n) => n.toLowerCase()));
const KNOWN_LOWER = new Map(Object.entries(KNOWN_PROCESSES).map(([n, d]) => [n.toLowerCase(), d]));

/** PIDs del propio servidor y sus procesos ancestros (terminal, shell, etc.) - nunca tocar. */
async function getProtectedPids() {
  const protected_ = new Set([process.pid]);
  try {
    const r = await spawnCapture('wmic', ['process', 'get', 'ProcessId,ParentProcessId', '/FORMAT:CSV']);
    if (r.code !== 0) return protected_;
    const parentOf = new Map();
    for (const line of r.stdout.trim().split(/\r?\n/)) {
      const cols = parseCsvLine(line);
      if (cols.length < 3) continue;
      const ppid = parseInt(cols[1], 10);
      const pid = parseInt(cols[2], 10);
      if (!Number.isNaN(pid) && !Number.isNaN(ppid)) parentOf.set(pid, ppid);
    }
    let cur = process.pid;
    const seen = new Set();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
      if (cur === 0 || protected_.has(cur)) break;
      protected_.add(cur);
    }
  } catch {}
  return protected_;
}

/**
 * Clasifica un proceso: 'critical' (sistema, nunca tocar), 'risky' (estado de
 * usuario, requiere seleccion manual), 'safe_known' (identificado, seguro de
 * liberar en bloque) o 'unknown' (no identificado, el usuario decide).
 *
 * `hasWindow` (ventana visible, vista en la columna "Window Title" de
 * `tasklist /V`) es la señal generica: no depende de que app sea ni de quien
 * la use, asi que generaliza a cualquier usuario/maquina. RISKY_PROCESSES es
 * solo un respaldo para apps con estado valioso que pueden no tener ventana
 * visible en el momento del escaneo (ej. OneDrive sincronizando, un IDE con
 * la ventana minimizada en otra sesion).
 */
function classifyProcessTier(name, hasWindow) {
  const lower = name.toLowerCase();
  if (CRITICAL_SET_LOWER.has(lower)) return 'critical';
  if (hasWindow || RISKY_SET_LOWER.has(lower)) return 'risky';
  if (KNOWN_LOWER.has(lower)) return 'safe_known';
  return 'unknown';
}

export async function runRamScanNative(cleanMode, minMB, onOutput) {
  const reportsDir = join(MODULES.ram.dir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `ram-report-${today}.md`);
  const countsPath = join(reportsDir, 'ram-counts.json');

  onOutput('Obteniendo memoria del sistema...');

  // ── RAM total/libra via wmic ──
  let totalRamMB = 0, freeRamMB = 0, usedRamMB = 0, usagePercent = 0;
  const memResult = await spawnCapture('wmic', ['OS', 'get', 'TotalVisibleMemorySize,FreePhysicalMemory', '/FORMAT:CSV']);
  if (memResult.code === 0) {
    const lines = memResult.stdout.trim().split(/\r?\n/);
    // wmic CSV devuelve header + data: saltar el header (primera linea)
    const dataLine = lines.filter((l) => /^\w/.test(l))[1];
    if (dataLine) {
      const cols = parseCsvLine(dataLine);
      const freeKB = parseInt(cols[1], 10) || 0;
      const totalKB = parseInt(cols[2], 10) || 0;
      totalRamMB = Math.round(totalKB / 1024);
      freeRamMB = Math.round(freeKB / 1024);
      usedRamMB = totalRamMB - freeRamMB;
      if (totalRamMB > 0) usagePercent = Math.round((usedRamMB / totalRamMB) * 100);
    }
  }

  // ── Procesos via tasklist (/V agrega la columna "Window Title", que es la
  // señal generica de "tiene ventana visible" - no depende del nombre de la app) ──
  onOutput('Listando procesos...');
  const procResult = await spawnCapture('tasklist', ['/V', '/FO', 'CSV', '/NH']);
  const processes = [];
  if (procResult.code === 0) {
    for (const line of procResult.stdout.trim().split(/\r?\n/)) {
      const cols = parseCsvLine(line);
      if (cols.length < 9) continue;
      const name = cols[0];
      const pid = parseInt(cols[1], 10);
      const memStr = (cols[4] || '0 K').replace(/,/g, '').trim();
      const memKB = parseInt(memStr, 10) || 0;
      const memMB = Math.round(memKB / 1024);
      const windowTitle = (cols[8] || '').trim();
      const hasWindow = windowTitle !== '' && windowTitle.toUpperCase() !== 'N/A';
      if (memMB > 0) processes.push({ name, pid, memMB, hasWindow });
    }
  }

  processes.sort((a, b) => b.memMB - a.memMB);
  const protectedPids = await getProtectedPids();
  for (const p of processes) {
    p.tier = protectedPids.has(p.pid) ? 'critical' : classifyProcessTier(p.name, p.hasWindow);
    p.knownDesc = KNOWN_LOWER.get(p.name.toLowerCase()) || null;
  }

  const knownProcs = processes.filter((p) => p.tier === 'safe_known');
  const unknownProcs = processes.filter((p) => p.tier === 'unknown');
  const riskyProcs = processes.filter((p) => p.tier === 'risky');
  const criticalProcs = processes.filter((p) => p.tier === 'critical');
  const threshold = minMB;
  let topCandidates = knownProcs.filter((p) => p.memMB >= threshold).slice(0, 20);
  let deepUnknownPids = new Set();
  if (cleanMode === 'deep') {
    const deepUnknown = unknownProcs
      .filter((p) => !p.hasWindow && p.memMB >= threshold)
      .sort((a, b) => b.memMB - a.memMB)
      .slice(0, 10);
    topCandidates = [...topCandidates, ...deepUnknown];
    deepUnknownPids = new Set(deepUnknown.map((p) => p.pid));
  }
  const riskyCandidates = riskyProcs.filter((p) => p.memMB >= threshold).slice(0, 20);
  // Excluye los que el modo profundo ya metio en topCandidates, para no
  // mostrarlos (y poder seleccionarlos) por duplicado en ambas listas.
  const unknownCandidates = unknownProcs
    .filter((p) => p.memMB >= threshold && !deepUnknownPids.has(p.pid))
    .slice(0, 20);

  // ── Build report ──
  const fmt = (v) => `${v} MB (${(v / 1024).toFixed(1)} GB)`;
  const lines = [
    `# Reporte de uso de RAM - ${today}`, '',
    '## Resumen de memoria', '',
    `- RAM total: ${fmt(totalRamMB)}`,
    `- RAM en uso: ${fmt(usedRamMB)}`,
    `- RAM libre: ${fmt(freeRamMB)}`,
    `- Uso: ${usagePercent}%`, '',
    `## Procesos identificados (mayor consumo)`, '',
  ];

  if (topCandidates.length > 0) {
    lines.push('```');
    for (const p of topCandidates) {
      const desc = p.knownDesc ? ` — ${p.knownDesc}` : '';
      const label = p.tier === 'unknown' ? '(incluido por modo profundo)' : '(seguro de liberar)';
      lines.push(`[${p.pid}] ${p.name}  ${p.memMB} MB${desc}  ${label}`);
    }
    lines.push('```');
  } else {
    lines.push(`No hay procesos candidatos con consumo >= ${threshold} MB.`);
  }
  lines.push('');

  lines.push(`## Procesos no recomendados (revisar antes de cerrar)`, '');
  lines.push('Editores, navegadores, sincronizacion, chat y similares: cerrarlos sin guardar pierde tu trabajo o sesion. No se preseleccionan ni se incluyen en "Seleccionar todos".', '');
  if (riskyCandidates.length > 0) {
    lines.push('```');
    for (const p of riskyCandidates) {
      lines.push(`[${p.pid}] ${p.name}  ${p.memMB} MB  (no recomendado)`);
    }
    lines.push('```');
  } else {
    lines.push('No hay procesos de esta categoria con consumo significativo.');
  }
  lines.push('');

  lines.push(`## Procesos no identificados (revisar antes de liberar)`, '');
  lines.push('Procesos en segundo plano sin descripcion conocida. No se incluyen en "Seleccionar todos". Puede liberarlos manualmente uno por uno.', '');
  if (unknownCandidates.length > 0) {
    lines.push('```');
    for (const p of unknownCandidates) {
      lines.push(`[${p.pid}] ${p.name}  ${p.memMB} MB  (no identificado)`);
    }
    lines.push('```');
  } else {
    lines.push('No hay procesos no identificados con consumo significativo.');
  }
  lines.push('');

  lines.push(`## Todos los procesos (${processes.length})`, '');
  lines.push(`- Identificados (seguros de liberar): ${knownProcs.length}`);
  lines.push(`- No identificados (revisar antes): ${unknownProcs.length}`);
  lines.push(`- No recomendados (editores/navegadores/sync/chat): ${riskyProcs.length}`);
  lines.push(`- Procesos criticos (no tocar): ${criticalProcs.length}`);
  lines.push('');

  writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');

  const top5 = topCandidates.slice(0, 5).map((p) => ({ name: p.name, pid: p.pid, mb: p.memMB, desc: p.knownDesc }));
  writeFileSync(countsPath, JSON.stringify({
    date: today, reportPath,
    total_mb: totalRamMB, used_mb: usedRamMB, free_mb: freeRamMB,
    usage_percent: usagePercent,
    total_processes: processes.length,
    known_processes: knownProcs.length,
    unknown_processes: unknownProcs.length,
    risky_processes: riskyProcs.length,
    critical_processes: criticalProcs.length,
    top_processes: top5, error: false,
  }, null, 2), 'utf-8');

  onOutput(`Reporte generado en: ${reportPath}`);
  onOutput(`Conteos generados en: ${countsPath}`);
}

/** Termina procesos seleccionados por el usuario (via taskkill). */
export async function runRamActionNative(envVars, onOutput) {
  const logDir = join(MODULES.ram.dir, 'reports');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, MODULES.ram.logFile);

  const writeLog = (message) => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const line = `[${stamp}] ${message}`;
    appendFileSync(logPath, line + '\n');
    onOutput(line);
  };

  writeLog('=== Liberacion de RAM - inicio ===');

  // Re-escanear procesos actuales (mismas columnas/criterio que el scan)
  const procResult = await spawnCapture('tasklist', ['/V', '/FO', 'CSV', '/NH']);
  const allProcesses = [];
  if (procResult.code === 0) {
    for (const line of procResult.stdout.trim().split(/\r?\n/)) {
      const cols = parseCsvLine(line);
      if (cols.length < 9) continue;
      const memStr = (cols[4] || '0 K').replace(/,/g, '').trim();
      const memKB = parseInt(memStr, 10) || 0;
      const memMB = Math.round(memKB / 1024);
      if (memMB > 0) {
        const pid = parseInt(cols[1], 10);
        const windowTitle = (cols[8] || '').trim();
        const hasWindow = windowTitle !== '' && windowTitle.toUpperCase() !== 'N/A';
        allProcesses.push({ name: cols[0], pid, memMB, hasWindow });
      }
    }
  }

  // Clasificacion en vivo de cada proceso (no la del momento del escaneo -
  // ver killIfStillEligible mas abajo, que re-valida con esto mismo justo
  // antes de matar). Nunca el propio servidor ni sus ancestros (terminal/shell).
  const protectedPids = await getProtectedPids();
  for (const p of allProcesses) {
    p.tier = protectedPids.has(p.pid) ? 'critical' : classifyProcessTier(p.name, p.hasWindow);
  }

  // Seleccion por PID (no por posicion en una lista): el frontend manda los
  // PIDs reales mostrados en el reporte. Si solo se usara la posicion N de
  // una lista recalculada en este momento, un proceso que cambio de orden
  // (su MB vario un poco entre el escaneo y este clic) haria que el indice
  // apunte a un proceso DISTINTO al que el usuario vio y marco - exactamente
  // el bug reportado ("seleccione uno y no hizo nada / hizo otra cosa").
  const parsePidSelection = (selection) => {
    const trimmed = (selection || '').trim();
    if (trimmed === '') return [];
    return trimmed.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
  };

  const knownPids = parsePidSelection(envVars.OPTIMIZE_PROCESSES);
  const unknownPids = parsePidSelection(envVars.UNKNOWN_PROCESSES);
  const riskyPids = parsePidSelection(envVars.RISKY_PROCESSES);

  const byPid = new Map(allProcesses.map((p) => [p.pid, p]));

  let killed = 0, errors = 0, freedMB = 0;

  /**
   * Mata un PID solo si SIGUE existiendo y su tier actual (re-derivado en
   * este mismo instante, no el que tenia en el escaneo) sigue siendo
   * compatible con la categoria que el usuario eligio. Nunca confia en que
   * "estaba en la lista de candidatos" siga siendo cierto - re-valida en
   * vivo, porque la clasificacion (sobre todo 'critical' por proteccion de
   * PID propio/ancestro) puede cambiar entre el escaneo y este momento.
   */
  async function killIfStillEligible(pid, allowedTiers, label) {
    const p = byPid.get(pid);
    if (!p) {
      writeLog(`OMITIDO (ya no existe): PID ${pid}`);
      return;
    }
    if (!allowedTiers.includes(p.tier)) {
      writeLog(`OMITIDO (clasificacion cambio a '${p.tier}', ya no es seguro liberarlo automaticamente): ${p.name} (PID: ${pid})`);
      return;
    }
    const r = await spawnCapture('taskkill', ['/PID', String(pid), '/F']);
    if (r.code === 0) {
      killed++;
      freedMB += p.memMB;
      writeLog(`Liberado${label}: ${p.name} (PID: ${pid}) - ${p.memMB} MB`);
    } else {
      errors++;
      writeLog(`ERROR liberando ${p.name} (PID: ${pid}): ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
    }
  }

  for (const pid of knownPids) {
    await killIfStillEligible(pid, ['safe_known', 'unknown'], '');
  }
  for (const pid of unknownPids) {
    await killIfStillEligible(pid, ['unknown'], ' (no identificado)');
  }
  for (const pid of riskyPids) {
    await killIfStillEligible(pid, ['risky'], ' (no recomendado, confirmado por el usuario)');
  }

  if (knownPids.length === 0 && unknownPids.length === 0 && riskyPids.length === 0) {
    writeLog('No se seleccionaron procesos para liberar.');
  } else {
    writeLog(`Procesos terminados: ${killed}, Errores: ${errors}, RAM liberada: ~${freedMB} MB`);
  }

  // Liberar memoria standby via EmptyWorkingSet (mueve paginas de cada
  // proceso a la standby list - no reduce el "RAM en uso" reportado por si
  // solo, ver vaciado real de standby list mas abajo).
  writeLog('Liberando working sets...');
  const standbyResult = await spawnCapture('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-Process | ForEach-Object { try { $_.EmptyWorkingSet() } catch {} }',
  ]);
  writeLog(standbyResult.code === 0 ? 'Working sets liberados.' : 'Error al liberar working sets.');

  // Vaciado real de la standby list (requiere administrador). Esto SI baja
  // el % de uso de RAM reportado, a diferencia de EmptyWorkingSet.
  const isAdmin = await isAdminWindows();
  if (!isAdmin) {
    writeLog('Vaciar lista en espera: OMITIDO (requiere ejecutar el servidor como administrador).');
  } else {
    writeLog('Vaciando lista en espera (standby list)...');
    const purgeResult = await spawnCapture('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', PURGE_STANDBY_LIST_SCRIPT,
    ]);
    const m = (purgeResult.stdout || '').match(/NTSTATUS:(-?\d+)\|(True|False)\|(True|False)/);
    const status = m ? parseInt(m[1], 10) : null;
    if (purgeResult.code === 0 && status === 0) {
      writeLog('Lista en espera vaciada correctamente.');
    } else if (m && (m[2] === 'False' || m[3] === 'False')) {
      writeLog(`ERROR vaciando lista en espera: el token de administrador no tiene el privilegio necesario (SeProfileSingleProcessPrivilege=${m[2]}, SeIncreaseQuotaPrivilege=${m[3]}). Revisa la directiva de seguridad local "Asignacion de derechos de usuario".`);
    } else {
      writeLog(`ERROR vaciando lista en espera (NTSTATUS=${status ?? 'desconocido'}): ${(purgeResult.stderr || '').trim().slice(0, 200)}`);
    }
  }

  writeLog('=== Liberacion de RAM - fin ===');
}
