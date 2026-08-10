import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  WINDIR, MODULES, spawnCapture, makeLogger, makeGuard, prepareReport, finishReport, errText,
} from './shared.js';

const HOSTS_PATH = join(WINDIR, 'System32', 'drivers', 'etc', 'hosts');
const MARCA_INICIO = '# === OPTIMIZADOR ADBLOCK INICIO (no editar a mano) ===';
const MARCA_FIN = '# === OPTIMIZADOR ADBLOCK FIN ===';

/**
 * Fuentes en formato hosts. Se indexan por clave, nunca se concatena input del
 * usuario en la URL: mismo criterio que la whitelist de modulos.
 *
 * Solo formato hosts a proposito. Las listas en sintaxis de AdBlock (AdGuard,
 * EasyList) traen reglas de elemento y comodines que el archivo hosts no sabe
 * expresar, asi que traducirlas seria inventar un subconjunto y mentir sobre
 * lo que quedo aplicado.
 */
const FUENTES = Object.freeze({
  stevenblack: Object.freeze({
    nombre: 'StevenBlack unificada',
    desc: 'Anuncios, rastreadores y malware. Es la lista base.',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  }),
  yoyo: Object.freeze({
    nombre: 'Peter Lowe (ad servers)',
    desc: 'Servidores de publicidad, lista chica y muy curada.',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
  }),
});

export const FUENTES_VALIDAS = Object.keys(FUENTES);

const listaPath = () => join(MODULES.adblock.dir, 'reports', 'blocklist.txt');
const metaPath = () => join(MODULES.adblock.dir, 'reports', 'blocklist-meta.json');

/** Comilla simple de PowerShell: la unica forma segura de pasar una ruta. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function leerHosts() {
  try {
    return readFileSync(HOSTS_PATH, 'utf-8');
  } catch {
    return '';
  }
}

/** Cuenta los dominios que hay dentro del bloque propio del hosts. */
export function estadoHosts(contenido = leerHosts()) {
  const lineas = contenido.split(/\r?\n/);
  const i = lineas.findIndex((l) => l.trim() === MARCA_INICIO);
  if (i === -1) return { activo: false, dominios: 0 };
  const fin = lineas.findIndex((l, idx) => idx > i && l.trim() === MARCA_FIN);
  const cuerpo = lineas.slice(i + 1, fin === -1 ? lineas.length : fin);
  return {
    activo: true,
    dominios: cuerpo.filter((l) => /^\s*0\.0\.0\.0\s+\S+/.test(l)).length,
  };
}

/**
 * Extrae dominios de un texto en formato hosts.
 *
 * Acepta tanto `0.0.0.0 dominio` como una linea con el dominio solo, porque
 * las fuentes no son consistentes entre si.
 */
const DOMINIO = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

export function parseHostsList(texto) {
  const out = new Set();
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.split('#')[0].trim();
    if (!limpia) continue;
    const partes = limpia.split(/\s+/);
    const dominio = (partes.length > 1 ? partes[1] : partes[0]).toLowerCase();
    // El mismo criterio que aplica el script elevado. Se filtra aca tambien
    // para no guardar basura en el archivo de lista.
    if (dominio.length > 253) continue;
    // El ultimo tramo tiene que ser alfabetico: sin eso, una linea suelta
    // `0.0.0.0` (las fuentes las traen) pasa como dominio valido y termina
    // escrita en el hosts. Ningun TLD real es numerico.
    if (!DOMINIO.test(dominio)) continue;
    if (dominio === 'localhost' || dominio.endsWith('.localhost')) continue;
    out.add(dominio);
  }
  return out;
}

async function descargarFuentes(claves, writeLog, onProgress) {
  const dominios = new Set();
  const detalle = [];

  for (const [i, clave] of claves.entries()) {
    const f = FUENTES[clave];
    writeLog(`Descargando ${f.nombre}...`);
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const texto = await res.text();
      const encontrados = parseHostsList(texto);
      for (const d of encontrados) dominios.add(d);
      detalle.push({ clave, nombre: f.nombre, dominios: encontrados.size, error: null });
      writeLog(`  ${encontrados.size} dominios de ${f.nombre}`);
    } catch (err) {
      detalle.push({ clave, nombre: f.nombre, dominios: 0, error: err.message });
      writeLog(`  ERROR bajando ${f.nombre}: ${err.message}`);
    }
    onProgress?.({
      current: i + 1,
      total: claves.length,
      percentage: Math.round(((i + 1) / claves.length) * 100),
    });
  }

  return { dominios, detalle };
}

export async function runAdblockScanNative(onOutput) {
  const paths = prepareReport('adblock');
  const { today, reportPath } = paths;

  onOutput('Leyendo el archivo hosts...');
  const estado = leerHosts();
  const { activo, dominios } = estadoHosts(estado);

  let lista = { existe: false, dominios: 0, fecha: null };
  if (existsSync(listaPath())) {
    const st = statSync(listaPath());
    const contenido = readFileSync(listaPath(), 'utf-8');
    lista = {
      existe: true,
      dominios: contenido.split('\n').filter(Boolean).length,
      fecha: st.mtime.toISOString().slice(0, 10),
      diasDesde: Math.floor((Date.now() - st.mtimeMs) / 86400000),
    };
  }

  const lines = [
    `# Reporte de bloqueo de anuncios - ${today}`, '',
    '## Estado', '',
    `- Bloqueo activo: ${activo ? 'si' : 'no'}`,
    `- Dominios bloqueados ahora: ${dominios}`,
    lista.existe
      ? `- Lista descargada: ${lista.dominios} dominios (${lista.fecha}, hace ${lista.diasDesde} dias)`
      : '- Lista descargada: ninguna todavia',
    '',
    '## Fuentes disponibles', '',
    '```',
    ...FUENTES_VALIDAS.map((k, i) => `[${i + 1}] ${FUENTES[k].nombre} — ${FUENTES[k].desc}`),
    '```',
    '',
    '## Alcance', '',
    '- Bloquea por dominio, asi que cubre publicidad y rastreo de terceros en',
    '  cualquier aplicacion, no solo en el navegador.',
    '- NO bloquea anuncios servidos desde el mismo dominio que el contenido',
    '  (Twitch, feed de Instagram, audio de Spotify). Eso no lo resuelve ningun',
    '  bloqueo por DNS.',
    '- Modificar el hosts requiere permisos de administrador: Windows va a pedir',
    '  confirmacion al aplicar y al quitar.',
    '',
  ];

  const counts = {
    date: today,
    reportPath,
    activo,
    blockedDomains: dominios,
    listDomains: lista.dominios,
    listDate: lista.fecha,
    listAgeDays: lista.diasDesde ?? null,
    error: false,
  };

  finishReport(paths, lines, counts, onOutput, {
    fuentes: FUENTES_VALIDAS.map((k) => ({
      id: k, name: FUENTES[k].nombre, desc: FUENTES[k].desc,
    })),
  });
}

export async function runAdblockActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('adblock', onOutput);
  const dryRun = envVars.DRY_RUN === 'true';
  const guard = makeGuard('adblock', { dryRun, writeLog });

  const accion = envVars.ADBLOCK_ACTION === 'remove' ? 'remove' : 'apply';
  const previo = estadoHosts();

  writeLog(`=== Bloqueo de anuncios - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  const reportsDir = join(MODULES.adblock.dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  if (accion === 'apply') {
    const claves = String(envVars.ADBLOCK_SOURCES || '')
      .split(',').map((s) => s.trim()).filter((s) => FUENTES_VALIDAS.includes(s));

    if (claves.length === 0) {
      writeLog('No se selecciono ninguna fuente. No hay nada que aplicar.');
      writeLog('=== Bloqueo de anuncios - fin ===');
      return;
    }

    // La descarga se hace siempre, incluso en simulacion: no modifica el
    // sistema y es lo que permite decir cuantos dominios se bloquearian.
    const { dominios, detalle } = await descargarFuentes(claves, writeLog, onProgress);

    if (dominios.size === 0) {
      writeLog('ERROR: no se pudo obtener ningun dominio. Se aborta sin tocar el hosts.');
      writeLog('=== Bloqueo de anuncios - fin ===');
      return;
    }

    writeFileSync(listaPath(), [...dominios].sort().join('\n') + '\n', 'utf-8');
    writeFileSync(metaPath(), JSON.stringify({ at: new Date().toISOString(), detalle }, null, 2));
    writeLog(`Lista consolidada: ${dominios.size} dominios unicos.`);
  }

  const descripcion = accion === 'apply'
    ? 'Bloquear anuncios en el archivo hosts'
    : 'Quitar el bloqueo de anuncios del archivo hosts';

  const r = await guard(descripcion, () => aplicarHosts(accion), {
    target: HOSTS_PATH,
    previousValue: previo.activo ? `activo (${previo.dominios} dominios)` : 'inactivo',
    newValue: accion === 'apply' ? 'activo' : 'inactivo',
  });

  if (r.simulated) {
    writeLog('=== Bloqueo de anuncios - fin (SIMULACION) ===');
    return;
  }

  if (r.code === 1223) {
    writeLog('Cancelado: no se aceptó el permiso de administrador. Nada cambio.');
    writeLog('=== Bloqueo de anuncios - fin ===');
    return;
  }

  // No se cree lo que reporta el script elevado: se vuelve a leer el hosts.
  const despues = estadoHosts();
  if (accion === 'apply' && despues.activo) {
    writeLog(`Bloqueo aplicado: ${despues.dominios} dominios en el archivo hosts.`);
  } else if (accion === 'remove' && !despues.activo) {
    writeLog('Bloqueo quitado. El archivo hosts volvio a su contenido previo.');
  } else {
    writeLog(`ERROR: el hosts no quedo como se esperaba (activo=${despues.activo}). ${errText(r)}`);
  }

  writeLog('=== Bloqueo de anuncios - fin ===');
}

/**
 * Escribe el bloque en el hosts, elevado. Separado de la accion porque el
 * deshacer del diario lo reusa: reaplicar no vuelve a descargar nada, usa el
 * blocklist.txt que ya quedo en disco.
 *
 * `Start-Process -Verb RunAs` es lo que dispara el UAC; sin eso la escritura
 * al hosts falla con acceso denegado.
 *
 * Las rutas van entrecomilladas al estilo PowerShell (comilla simple doblada):
 * un nombre de usuario con apostrofe rompe el comando si no.
 */
export async function aplicarHosts(accion) {
  const backupDir = join(MODULES.adblock.dir, 'reports');
  mkdirSync(backupDir, { recursive: true });

  const script = join(
    process.env.OPTIMIZADOR_SCRIPTS_DIR || join(MODULES.adblock.dir, '..', 'scripts'),
    'Apply-Hosts.ps1',
  );

  const argsInternos = [
    '-ep', 'Bypass', '-nop', '-File', psQuote(script),
    '-Action', psQuote(accion), '-BackupDir', psQuote(backupDir),
  ];
  if (accion === 'apply') argsInternos.push('-ListFile', psQuote(listaPath()));

  const comando =
    `try { $p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
    `-ArgumentList @(${argsInternos.join(',')}); exit $p.ExitCode } catch { exit 1223 }`;

  return spawnCapture('powershell.exe', ['-ep', 'Bypass', '-nop', '-Command', comando], 300000);
}
