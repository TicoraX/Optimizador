import { Resolver } from 'dns/promises';
import {
  spawnCapture, isAdminWindows, makeLogger, prepareReport, finishReport, errText, padRight,
} from './shared.js';

const OBJETIVO = '8.8.8.8';
const MUESTRAS_PING = 20;

/**
 * Milisegundos de una linea de respuesta de `ping`, sea cual sea el idioma de
 * Windows. `tiempo=23ms`, `time=23ms` y `time<1ms` caen todos aca.
 *
 * El modulo de energia ya se habia roto por depender de un literal en ingles;
 * no se repite el error.
 */
const MS = /[=<]\s*(\d+)\s*ms/i;

/**
 * Solo las lineas de respuesta, no el resumen.
 *
 * El resumen ("Minimo = 20ms, Maximo = 30ms, Media = 23ms") tambien tiene
 * `= NNms`, asi que contaba como tres respuestas mas y daba perdida negativa.
 * `TTL` es el discriminador: Windows no lo traduce en ningun idioma y solo
 * aparece en las respuestas reales.
 */
const esRespuesta = (linea) => /TTL[=:]/i.test(linea) && MS.test(linea);

const percentil = (ordenados, p) => {
  if (ordenados.length === 0) return null;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[i];
};

/** Latencia sostenida. Cuatro pings no dicen nada: lo que arruina una partida
 *  es la varianza, no el promedio. */
export function analizarPings(salida, enviados) {
  const muestras = salida.split(/\r?\n/)
    .filter(esRespuesta)
    .map((l) => Number(l.match(MS)[1]));

  if (muestras.length === 0) {
    return { recibidos: 0, perdidaPct: 100, min: null, mediana: null, p95: null, max: null, jitter: null };
  }

  const ord = [...muestras].sort((a, b) => a - b);
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
  // Jitter como desviacion estandar: es lo que se siente como "tironeo".
  const jitter = Math.sqrt(
    muestras.reduce((acc, v) => acc + (v - media) ** 2, 0) / muestras.length,
  );

  return {
    recibidos: muestras.length,
    perdidaPct: Math.round(((enviados - muestras.length) / enviados) * 100),
    min: ord[0],
    mediana: percentil(ord, 50),
    p95: percentil(ord, 95),
    max: ord[ord.length - 1],
    jitter: Math.round(jitter * 10) / 10,
  };
}

/** Saltos de `tracert -d`, con su latencia. Un `*` es un salto que no responde. */
export function parseTracert(salida) {
  const saltos = [];
  for (const linea of salida.split(/\r?\n/)) {
    const m = linea.match(/^\s*(\d{1,2})\s+(.*)$/);
    if (!m) continue;
    const resto = m[2];
    const tiempos = [...resto.matchAll(/[<]?\s*(\d+)\s*ms/gi)].map((x) => Number(x[1]));
    // La ultima columna es la IP; si el salto no respondio no hay ninguna.
    const ip = (resto.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*$/) || [])[1] || null;
    saltos.push({
      salto: Number(m[1]),
      ip,
      ms: tiempos.length ? Math.min(...tiempos) : null,
      responde: tiempos.length > 0,
    });
  }
  return saltos;
}

/**
 * MTU util por busqueda binaria: `-f` prohibe fragmentar, asi que un payload
 * mas grande que el camino falla. Se le suman 28 bytes de cabecera IP+ICMP.
 */
async function descubrirMtu(onOutput) {
  let bajo = 1200, alto = 1472, mejor = null;
  while (bajo <= alto) {
    const medio = Math.floor((bajo + alto) / 2);
    const r = await spawnCapture('ping', ['-n', '1', '-w', '800', '-f', '-l', String(medio), OBJETIVO]);
    const paso = r.stdout.split(/\r?\n/).some(esRespuesta);
    if (paso) { mejor = medio; bajo = medio + 1; } else { alto = medio - 1; }
  }
  if (mejor === null) {
    onOutput('  No se pudo determinar el MTU (el destino no responde a ping con -f).');
    return null;
  }
  return mejor + 28;
}

/**
 * Compara resolutores midiendo lo que tardan en resolver.
 *
 * Afecta cuanto tarda en abrir una web, no el ping del juego: son cosas
 * distintas y el reporte lo dice para que nadie cambie el DNS esperando
 * mejorar la latencia en linea.
 */
async function compararDns(onOutput) {
  const dominios = ['github.com', 'wikipedia.org', 'cloudflare.com', 'microsoft.com'];
  const candidatos = [
    { nombre: 'Actual (del sistema)', servers: null },
    { nombre: 'Cloudflare', servers: ['1.1.1.1'] },
    { nombre: 'Google', servers: ['8.8.8.8'] },
    { nombre: 'Quad9', servers: ['9.9.9.9'] },
  ];

  const out = [];
  for (const c of candidatos) {
    const r = new Resolver({ timeout: 2000, tries: 1 });
    if (c.servers) r.setServers(c.servers);
    const tiempos = [];
    for (const d of dominios) {
      const t0 = performance.now();
      try {
        await r.resolve4(d);
        tiempos.push(performance.now() - t0);
      } catch { /* un fallo no invalida al resolutor: se promedia lo que si respondio */ }
    }
    const ms = tiempos.length
      ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)
      : null;
    out.push({ nombre: c.nombre, servidor: c.servers?.[0] || null, ms, resueltos: tiempos.length });
    onOutput(`  ${c.nombre}: ${ms === null ? 'sin respuesta' : `${ms} ms`}`);
  }
  return out;
}

// Una sola llamada a PowerShell para todo lo que necesita PowerShell: arrancarlo
// cuesta ~200 ms y antes este modulo no lo usaba, pero pedir tres cosas por
// separado costaria mas que la consulta en si.
const INFO_PS = `
$ad = Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object {
  $pm = $null
  try { $pm = (Get-NetAdapterPowerManagement -Name $_.Name -ErrorAction Stop).AllowComputerToTurnOffDevice } catch {}
  [pscustomobject]@{
    nombre = $_.Name
    desc = $_.InterfaceDescription
    velocidad = $_.LinkSpeed
    medio = [string]$_.MediaType
    ahorroEnergia = [string]$pm
  }
}
$dns = Get-DnsClientServerAddress -AddressFamily IPv4 |
  Where-Object { $_.ServerAddresses.Count -gt 0 } |
  ForEach-Object { [pscustomobject]@{ interfaz = $_.InterfaceAlias; servidores = $_.ServerAddresses } }
[pscustomobject]@{ adaptadores = @($ad); dns = @($dns) } | ConvertTo-Json -Depth 4 -Compress
`;

export async function runNetworkScanNative(bufferbloat, onOutput, onProgress) {
  const paths = prepareReport('network');
  const { today, reportPath } = paths;
  let scanError = false;

  const pasos = bufferbloat ? 6 : 5;
  let paso = 0;
  const avanzar = () => {
    paso += 1;
    onProgress?.({ current: paso, total: pasos, percentage: Math.round((paso / pasos) * 100) });
  };

  onOutput(`Midiendo latencia sostenida (${MUESTRAS_PING} muestras)...`);
  const ping = await spawnCapture('ping', ['-n', String(MUESTRAS_PING), OBJETIVO], 60000);
  const lat = analizarPings(ping.stdout, MUESTRAS_PING);
  if (lat.recibidos === 0) scanError = true;
  onOutput(`  mediana ${lat.mediana} ms, p95 ${lat.p95} ms, jitter ${lat.jitter} ms, perdida ${lat.perdidaPct}%`);
  avanzar();

  onOutput('Trazando la ruta hasta el destino...');
  const tr = await spawnCapture('tracert', ['-d', '-h', '10', '-w', '600', OBJETIVO], 90000);
  const saltos = parseTracert(tr.stdout);
  avanzar();

  onOutput('Consultando adaptadores y DNS configurado...');
  const info = await spawnCapture('powershell.exe', ['-ep', 'Bypass', '-nop', '-Command', INFO_PS], 30000);
  let adaptadores = [], dnsConfigurado = [];
  try {
    const j = JSON.parse(info.stdout.trim() || '{}');
    adaptadores = j.adaptadores || [];
    dnsConfigurado = j.dns || [];
  } catch { scanError = true; }
  avanzar();

  onOutput('Buscando el MTU util...');
  const mtu = await descubrirMtu(onOutput);
  avanzar();

  onOutput('Comparando servidores DNS...');
  const dns = await compararDns(onOutput);
  avanzar();

  let carga = null;
  if (bufferbloat) {
    onOutput('Midiendo latencia bajo carga (esto satura la conexion unos segundos)...');
    carga = await medirBajoCarga(onOutput);
    avanzar();
  }

  const cacheDns = await spawnCapture('ipconfig', ['/displaydns']);
  const dnsEntries = cacheDns.code === 0
    ? cacheDns.stdout.split(/\r?\n/).filter((l) => /^\s+(?:Nombre|Name)\s+\./.test(l)).length
    : 0;

  // Diagnostico: el primer salto es la red local. Si ya viene alto, el problema
  // esta de la puerta para adentro y ningun ajuste de Windows lo arregla.
  const primerSalto = saltos.find((s) => s.responde);
  const conAhorro = adaptadores.filter((a) => a.ahorroEnergia === 'True');
  const mejorDns = dns.filter((d) => d.ms !== null).sort((a, b) => a.ms - b.ms)[0];

  const diagnostico = [];
  if (primerSalto && primerSalto.ms > 5) {
    diagnostico.push(`El primer salto (${primerSalto.ip}, tu router) responde en ${primerSalto.ms} ms. Arriba de 5 ms por cable indica un problema local: cable, puerto o el router saturado.`);
  }
  if (lat.jitter !== null && lat.jitter > 10) {
    diagnostico.push(`Jitter de ${lat.jitter} ms. Arriba de 10 ms se siente como tironeo aunque el ping promedio sea bueno.`);
  }
  if (lat.perdidaPct > 0) {
    diagnostico.push(`Hay ${lat.perdidaPct}% de perdida de paquetes. Cualquier perdida sostenida importa mas que el ping.`);
  }
  if (conAhorro.length > 0) {
    diagnostico.push(`Windows tiene permiso para apagar ${conAhorro.map((a) => a.nombre).join(', ')} para ahorrar energia. Es una causa real de picos de latencia y se desactiva en las propiedades del adaptador.`);
  }
  if (carga && carga.delta !== null && carga.delta > 100) {
    diagnostico.push(`Bufferbloat: bajo carga la latencia sube ${carga.delta} ms (de ${carga.reposo} a ${carga.cargado}). Esto es lo que hace que todo se sienta mal cuando alguien mas descarga algo. Se arregla en el router, activando SQM o QoS, no en Windows.`);
  }
  if (mejorDns && mejorDns.servidor && dns[0].ms !== null && mejorDns.ms < dns[0].ms * 0.7) {
    diagnostico.push(`${mejorDns.nombre} resuelve mas rapido que tu DNS actual (${mejorDns.ms} vs ${dns[0].ms} ms). Afecta cuanto tarda en abrir una web, no el ping del juego.`);
  }
  if (diagnostico.length === 0) {
    diagnostico.push('No se detectaron problemas locales. Si la latencia en juego es mala igual, el cuello de botella esta fuera de tu red y no hay ajuste local que lo cambie.');
  }

  const lines = [
    `# Reporte de Red - ${today}`, '',
    `## Latencia hasta ${OBJETIVO}`, '',
    '```',
    `Minimo     ${lat.min ?? '—'} ms`,
    `Mediana    ${lat.mediana ?? '—'} ms`,
    `p95        ${lat.p95 ?? '—'} ms`,
    `Maximo     ${lat.max ?? '—'} ms`,
    `Jitter     ${lat.jitter ?? '—'} ms  (desviacion estandar)`,
    `Perdida    ${lat.perdidaPct}%  (${lat.recibidos}/${MUESTRAS_PING} respuestas)`,
    '```', '',
    '## Ruta hasta el destino', '',
    'Donde se agrega la latencia. El salto 1 es tu router.', '',
    '```',
    ...saltos.map((s) => `${padRight(String(s.salto), 4)}${padRight(s.ip || '*', 18)}${s.responde ? `${s.ms} ms` : 'sin respuesta'}`),
    '```', '',
  ];

  if (carga) {
    lines.push('## Latencia bajo carga (bufferbloat)', '',
      '```',
      `En reposo   ${carga.reposo ?? '—'} ms`,
      `Bajo carga  ${carga.cargado ?? '—'} ms`,
      `Diferencia  ${carga.delta ?? '—'} ms`,
      '```', '');
  }

  lines.push(
    '## Servidores DNS', '',
    'Tiempo medio de resolucion sobre 4 dominios.', '',
    '```',
    ...dns.map((d) => `${padRight(d.nombre, 24)}${d.ms === null ? 'sin respuesta' : `${d.ms} ms`}`),
    '```', '',
    `DNS configurado: ${dnsConfigurado.map((d) => `${d.interfaz} → ${[].concat(d.servidores).join(', ')}`).join(' | ') || 'desconocido'}`,
    '',
    '## Adaptadores', '',
    '```',
    ...adaptadores.map((a) => `${padRight(a.nombre, 16)}${padRight(a.velocidad, 10)}${a.ahorroEnergia === 'True' ? 'ahorro de energia ACTIVADO' : 'ahorro de energia off'}`),
    '```', '',
    // Como items de lista: en Markdown dos lineas contiguas se funden en un
    // mismo parrafo y quedaba "MTU util: 1480 bytes Cache DNS: 0 entradas".
    `- MTU util: ${mtu ? `${mtu} bytes` : 'no determinado'}`,
    `- Cache DNS: ${dnsEntries} entradas`, '',
    '## Diagnostico', '',
    ...diagnostico.map((d) => `- ${d}`), '',
    '## Que NO puede hacer esta app', '',
    '- No puede bajar el ping cambiando la ruta hacia el servidor del juego. Eso',
    '  es lo que hacen ExitLag y similares, y requiere una red de servidores',
    '  propia con mejor peering. No se puede replicar localmente.',
    '- Los ajustes de registro tipo TcpAckFrequency o Nagle son de TCP; los',
    '  juegos competitivos usan UDP y no los tocan.',
    '',
  );

  finishReport(paths, lines, {
    date: today, reportPath,
    dns_cache_entries: dnsEntries,
    avg_ping_ms: lat.mediana,
    jitter_ms: lat.jitter,
    p95_ping_ms: lat.p95,
    packet_loss: lat.perdidaPct,
    first_hop_ms: primerSalto?.ms ?? null,
    hops: saltos.length,
    mtu,
    power_saving_adapters: conAhorro.length,
    bufferbloat_delta_ms: carga?.delta ?? null,
    best_dns: mejorDns?.nombre ?? null,
    active_adapters: adaptadores.length,
    disconnected_adapters: 0,
    error: scanError,
  }, onOutput);
}

/**
 * Latencia en reposo contra latencia con el enlace saturado.
 *
 * Es la medicion que mas explica una conexion domestica que "se siente mal":
 * un test de velocidad normal no la ve, porque mide caudal y no demora. El
 * arreglo no es local, es activar SQM en el router, pero saberlo vale.
 */
async function medirBajoCarga(onOutput) {
  const base = analizarPings(
    (await spawnCapture('ping', ['-n', '5', OBJETIVO], 20000)).stdout, 5,
  );

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB límite de seguridad

  // Descarga de un endpoint publico de medicion solo para ocupar el enlace.
  // Se descarta a medida que llega: no se guarda nada.
  const saturar = (async () => {
    try {
      const res = await fetch('https://speed.cloudflare.com/__down?bytes=50000000', {
        signal: ctrl.signal,
      });
      if (res.body) {
        let bytes = 0;
        for await (const chunk of res.body) {
          bytes += chunk?.length || 0;
          if (bytes >= MAX_BYTES) {
            ctrl.abort();
            break;
          }
        }
      }
    } catch { /* abortado a proposito */ }
  })();

  await new Promise((r) => setTimeout(r, 1500));
  const cargado = analizarPings(
    (await spawnCapture('ping', ['-n', '8', OBJETIVO], 30000)).stdout, 8,
  );

  clearTimeout(timeout);
  ctrl.abort();
  await saturar;

  if (base.mediana === null || cargado.mediana === null) {
    onOutput('  No se pudo medir la latencia bajo carga.');
    return { reposo: base.mediana, cargado: cargado.mediana, delta: null };
  }
  const delta = cargado.mediana - base.mediana;
  onOutput(`  reposo ${base.mediana} ms, bajo carga ${cargado.mediana} ms (+${delta} ms)`);
  return { reposo: base.mediana, cargado: cargado.mediana, delta };
}

export async function runNetworkActionNative(envVars, onOutput, onProgress) {
  const writeLog = makeLogger('network', onOutput);
  const dryRun = envVars?.DRY_RUN === 'true';

  writeLog(`=== Optimizacion de Red - inicio${dryRun ? ' (SIMULACION)' : ''} ===`);

  if (dryRun) {
    writeLog('Simulación: ipconfig /flushdns e ipconfig /registerdns se ejecutarían.');
    onProgress?.(100);
    writeLog('=== Optimizacion de Red - fin ===');
    return;
  }

  writeLog('Limpiando cache DNS...');
  onProgress?.(25);
  const flushResult = await spawnCapture('ipconfig', ['/flushdns']);
  if (flushResult.code === 0) {
    writeLog('Cache DNS limpiada exitosamente.');
  } else {
    writeLog(`ERROR limpiando cache DNS: ${errText(flushResult)}`);
  }
  onProgress?.(50);

  const isAdmin = await isAdminWindows();
  if (isAdmin) {
    writeLog('Re-registrando DNS...');
    const regResult = await spawnCapture('ipconfig', ['/registerdns']);
    if (regResult.code === 0) {
      writeLog('DNS re-registrado exitosamente.');
    } else {
      writeLog(`ERROR re-registrando DNS: ${errText(regResult)}`);
    }
  } else {
    writeLog('Omitiendo re-registro DNS (requiere administrador).');
  }
  onProgress?.(100);

  // Se dice explicitamente para no vender humo: esto no baja el ping.
  writeLog('Nota: limpiar la cache DNS no reduce la latencia en juego. Sirve');
  writeLog('cuando un dominio resuelve a una IP vieja, nada mas.');
  writeLog('=== Optimizacion de Red - fin ===');
}
