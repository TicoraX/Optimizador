import { useState, useCallback, useMemo } from 'react';
import { API_BASE } from '../config.js';

/**
 * Gestiona el estado de items seleccionables de un módulo.
 *
 * Cubre el patrón repetido: fetch → items[] → selected{} → toggle → buildBody.
 * Los módulos con formas especiales (cleanup, startup, ram, power, adblock)
 * NO usan este hook: su lógica no encaja en el shape genérico y forzarla
 * sería más código que el ahorro.
 */

// Mapa de cómo inicializar la selección al cargar items.
// `defaultCheck` recibe un item y devuelve si debe estar marcado.
// `idKey` es la propiedad que se usa como clave (por defecto, índice).
const MODULE_CONFIG = {
  services:       { idKey: 'name',    defaultCheck: () => false },
  apps:           { idKey: 'id',      defaultCheck: () => false },
  privacy:        { idKey: null,      defaultCheck: () => false },
  gaming:         { idKey: 'id',      defaultCheck: (it) => !it.optimized },
  integrity:      { idKey: 'action',  defaultCheck: (it) => it.recommended !== false },
  contextmenu:    { idKey: 'regPath', defaultCheck: (it) => it.recommendedDisable === true },
  oemdebloat:     { idKey: 'serviceName', defaultCheck: (it) => it.recommendedManual === true },
  timers:         { idKey: 'id',      defaultCheck: (it) => !it.isOptimized },
  ghostdevices:   { idKey: 'id',      defaultCheck: (it) => it.recommended === true },
  searchindex:    { idKey: 'id',      defaultCheck: (it) => !it.isOptimized },
  dnsflush:       { idKey: 'id',      defaultCheck: (it) => it.recommended === true },
  networkprivacy: { idKey: 'id',      defaultCheck: (it) => !it.isOptimized },
  pagefile:       { idKey: 'id',      defaultCheck: (it) => !it.isOptimized },
  werfault:       { idKey: 'id',      defaultCheck: (it) => !it.isOptimized },
  smartdisk:      { idKey: 'id',      defaultCheck: () => true },
  shadercache:    { idKey: 'id',      defaultCheck: (it) => it.files > 0 },
  updates:        { idKey: 'id',      defaultCheck: () => true },
};

/**
 * @param {string} module — clave del módulo activo
 * @returns {{ items, selected, toggle, selectAll, deselectAll, hasSelected, clear, load, buildChecked, config }}
 */
export function useModuleItems(module) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});

  const config = MODULE_CONFIG[module];

  const clear = useCallback(() => {
    setItems([]);
    setSelected({});
  }, []);

  const load = useCallback(async () => {
    if (!config) { clear(); return; }

    try {
      const res = await fetch(`${API_BASE}/reports/${module}/items`);
      if (!res.ok) { clear(); return; }
      const { items: raw } = await res.json();

      const list = Array.isArray(raw) ? raw : [];
      setItems(list);
      setSelected(
        Object.fromEntries(list.map((it, i) => [i, config.defaultCheck(it)]))
      );
    } catch {
      clear();
    }
  }, [module, config, clear]);

  const toggle = useCallback((index) => {
    setSelected((prev) => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(Object.fromEntries(items.map((_, i) => [i, true])));
  }, [items]);

  const deselectAll = useCallback(() => {
    setSelected(Object.fromEntries(items.map((_, i) => [i, false])));
  }, [items]);

  const hasSelected = useMemo(() => {
    return items.length > 0 && Object.values(selected).some(Boolean);
  }, [items, selected]);

  /** Devuelve los IDs (o índices +1 para privacy) de los items marcados. */
  const buildChecked = useCallback(() => {
    if (!config) return [];

    const checked = Object.keys(selected).filter((k) => selected[k]);

    if (config.idKey === null) {
      // privacy: índices 1-based
      return checked.map((k) => parseInt(k) + 1);
    }

    return checked
      .map((k) => items[parseInt(k)]?.[config.idKey])
      .filter(Boolean);
  }, [selected, items, config]);

  return { items, selected, toggle, selectAll, deselectAll, hasSelected, clear, load, buildChecked, config };
}

/** Módulos que usan el hook genérico (no los especiales). */
export const GENERIC_MODULES = new Set(Object.keys(MODULE_CONFIG));
