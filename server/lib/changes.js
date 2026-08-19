import { rename } from 'fs/promises';
import {
  VALID_MODULES, spawnCapture, readChanges, writeChanges, errText,
} from './shared.js';

/**
 * Deshacer un cambio aplicado.
 *
 * Solo se puede revertir lo que guardo su valor anterior. Lo demas (un archivo
 * borrado, una app desinstalada, un proceso terminado) se anota como
 * irreversible en el diario y no ofrece boton, en vez de fingir que se puede.
 *
 * Cada revert usa el MISMO binario que aplico el cambio, con el valor que la
 * fila del diario copio en su momento. Nada se recalcula leyendo el sistema:
 * la fila dice como estaba ese dia y eso es lo que se restaura.
 */
const REVERTERS = {
  /**
   * El bloque del hosts se identifica por marcadores, asi que deshacer es
   * aplicar la accion contraria, no reescribir el archivo desde una copia:
   * restaurar un backup completo pisaria las entradas que el usuario haya
   * agregado a mano despues.
   *
   * Vuelve a pedir UAC, igual que la accion original.
   */
  async adblock(change) {
    const { aplicarHosts, estadoHosts } = await import('./adblock.js');
    const volverAActivar = String(change.previousValue || '').startsWith('activo');
    const r = await aplicarHosts(volverAActivar ? 'apply' : 'remove');
    const ok = r.code === 0 && estadoHosts().activo === volverAActivar;
    if (ok) return { ok, detail: null };
    return {
      ok,
      detail: r.code === 1223 ? 'Se cancelo el permiso de administrador' : errText(r),
    };
  },

  async services(change) {
    // previousValue es 'auto' | 'demand' | 'disabled', tal como lo acepta sc.
    const r = await spawnCapture('sc.exe', ['config', change.target, 'start=', change.previousValue]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },

  async privacy(change) {
    const [key, valueName] = splitRegTarget(change.target);
    if (change.previousValue === null || change.previousValue === undefined) {
      // No existia antes: borrar el valor es la restauracion correcta.
      const r = await spawnCapture('reg', ['delete', key, '/v', valueName, '/f']);
      return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
    }
    const r = await spawnCapture('reg', [
      'add', key, '/v', valueName, '/t', change.valueType || 'REG_DWORD',
      '/d', String(change.previousValue), '/f',
    ]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },

  async gaming(change) {
    return REVERTERS.privacy(change);
  },

  async contextmenu(change) {
    return REVERTERS.privacy(change);
  },

  async searchindex(change) {
    return REVERTERS.privacy(change);
  },

  async networkprivacy(change) {
    return REVERTERS.privacy(change);
  },

  async pagefile(change) {
    return REVERTERS.privacy(change);
  },

  async werfault(change) {
    return REVERTERS.privacy(change);
  },

  async oemdebloat(change) {
    const serviceName = String(change.target || '').replace(/^Service\\/, '');
    const prev = change.previousValue || 'demand';
    const r = await spawnCapture('sc.exe', ['config', serviceName, 'start=', prev]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },

  async timers(change) {
    const param = String(change.target || '').replace(/^BCD\\\{current\}\\/, '');
    if (!change.previousValue || change.previousValue.startsWith('Default')) {
      const r = await spawnCapture('bcdedit', ['/deletevalue', param]);
      return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
    }
    const r = await spawnCapture('bcdedit', ['/set', param, change.previousValue]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },

  async power(change) {
    if (!change.previousValue) return { ok: false, detail: 'No hay esquema de energía anterior registrado' };
    const r = await spawnCapture('powercfg', ['/setactive', change.previousValue]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },

  async startup(change) {
    // Tarea programada: el previousValue es su estado anterior.
    if (change.previousValue === 'Disabled' || change.newValue === 'Disabled') {
      const flag = change.newValue === 'Disabled' ? '/Enable' : '/Disable';
      const r = await spawnCapture('schtasks', ['/Change', '/TN', change.target, flag]);
      return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
    }
    // Acceso directo: se movio de previousValue a target, se vuelve a mover.
    if (String(change.previousValue || '').toLowerCase().endsWith('.lnk')) {
      try {
        await rename(change.target, change.previousValue);
        return { ok: true, detail: null };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    }
    // Entrada de registro: se restaura con su tipo original.
    const [key, valueName] = splitRegTarget(change.target);
    const r = await spawnCapture('reg', [
      'add', key, '/v', valueName, '/t', change.valueType || 'REG_SZ',
      '/d', String(change.previousValue), '/f',
    ]);
    return { ok: r.code === 0, detail: r.code === 0 ? null : errText(r) };
  },
};

/** `HKLM\Ruta\Larga\NombreDelValor` → [clave, nombre]. */
function splitRegTarget(target) {
  const s = String(target);
  const i = s.lastIndexOf('\\');
  if (i === -1) return [s, ''];
  return [s.slice(0, i), s.slice(i + 1)];
}

/** Todos los diarios, mas reciente primero. */
export function listAllChanges() {
  const all = [];
  for (const key of VALID_MODULES) {
    for (const c of readChanges(key)) all.push(c);
  }
  return all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export async function undoChange(moduleKey, id) {
  const journal = readChanges(moduleKey);
  const change = journal.find((c) => c.id === id);

  if (!change) return { ok: false, status: 404, error: 'Ese cambio no existe' };
  if (change.undoneAt) return { ok: false, status: 409, error: 'Ese cambio ya se deshizo' };
  if (!change.reversible) {
    return { ok: false, status: 400, error: 'Ese cambio no se puede deshacer: no se guardo un valor anterior' };
  }

  const revert = REVERTERS[moduleKey];
  if (!revert) return { ok: false, status: 400, error: `El modulo ${moduleKey} no soporta deshacer` };

  const result = await revert(change);
  if (!result.ok) {
    return { ok: false, status: 500, error: `No se pudo deshacer: ${result.detail || 'error desconocido'}` };
  }

  // Re-leer el diario fresco por si hubo escrituras concurrentes durante el revert
  const freshJournal = readChanges(moduleKey);
  const freshChange = freshJournal.find((c) => c.id === id) || change;
  freshChange.undoneAt = new Date().toISOString();
  writeChanges(moduleKey, freshJournal);
  return { ok: true, change: freshChange };
}
