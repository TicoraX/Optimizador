import { useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { MODULES, MODULE_KEYS } from '../modules';
import { ModuleIcon } from './ModuleIcon';
import { API_BASE } from '../config';

// recharts pesa ~500 KB y alimenta un solo grafico que ni siquiera se muestra
// si no hay historial de arranque. Antes se importaba estatico.
const BootChart = lazy(() => import('./BootChart'));

// ponytail: persistencia en localStorage, sin backend ni libreria de drag&drop
function usePersistedModuleLayout() {
  const [order, setOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('moduleOrder'));
      if (Array.isArray(saved)) {
        const merged = saved.filter((id) => MODULE_KEYS.includes(id));
        MODULE_KEYS.forEach((id) => { if (!merged.includes(id)) merged.push(id); });
        return merged;
      }
    } catch { /* localStorage vacio o corrupto */ }
    return MODULE_KEYS;
  });

  const [hidden, setHidden] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hiddenModules'));
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });

  const persist = (nextOrder, nextHidden) => {
    localStorage.setItem('moduleOrder', JSON.stringify(nextOrder));
    localStorage.setItem('hiddenModules', JSON.stringify(nextHidden));
  };

  const moveModule = (id, delta) => {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      persist(next, hidden);
      return next;
    });
  };

  const toggleHidden = (id) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(order, next);
      return next;
    });
  };

  return { order, hidden, moveModule, toggleHidden };
}

function ModuleCard({ moduleKey, data, scanning, onScan, onOpen, style, revealIndex }) {
  const mod = MODULES[moduleKey];
  const metrics = data ? mod.metrics(data) : [];
  const stale = !data?.lastScan;

  return (
    <article
      className="glass-panel module-card reveal"
      data-span={mod.span}
      style={{ ...style, '--reveal-index': revealIndex }}
      aria-labelledby={`card-${moduleKey}`}
    >
      <header className="card-header">
        <span className="card-icon"><ModuleIcon path={mod.icon} /></span>
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title" id={`card-${moduleKey}`}>{mod.label}</h2>
          <div className="card-subtitle">
            {stale ? 'Sin escanear' : `Último escaneo ${data.lastScan}`}
          </div>
        </div>
      </header>

      <div className="card-body">
        {stale ? (
          <p style={{ margin: 0, color: 'var(--color-ink-3)' }}>{mod.blurb}</p>
        ) : (
          metrics.map((m) => (
            <div className="metric-row" key={m.label}>
              <span className="metric-label">{m.label}</span>
              <span className={`metric-value ${m.tone || ''}`}>{m.value}</span>
            </div>
          ))
        )}
      </div>

      <footer className="card-footer">
        <button
          className="btn btn-secondary"
          onClick={() => onScan(moduleKey)}
          disabled={scanning}
        >
          {scanning ? 'Escaneando…' : 'Escanear'}
        </button>
        <button className="btn btn-quiet" onClick={() => onOpen(moduleKey)}>
          Abrir
        </button>
      </footer>
    </article>
  );
}

export default function Dashboard({ systemStatus, loading, error, onRefreshStatus }) {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState({});
  const [customizing, setCustomizing] = useState(false);
  const { order, hidden, moveModule, toggleHidden } = usePersistedModuleLayout();

  // Antes esto parseaba el stream SSE a mano buscando el string 'event: done',
  // que se rompe si un chunk llega partido. fetchEventSource ya estaba instalado.
  const handleScan = useCallback(async (moduleKey) => {
    if (scanning[moduleKey]) return;
    setScanning((prev) => ({ ...prev, [moduleKey]: true }));

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 330000);

    try {
      await fetchEventSource(`${API_BASE}/scan/${moduleKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: ctrl.signal,
        openWhenHidden: true,
        // El defaultOnOpen de la libreria solo mira el content-type, no el
        // status. Un 429 del rate limit o un 403 de origen fallaban con
        // "Expected content-type..." en vez del motivo real.
        onopen(res) {
          if (!res.ok) throw new Error(`El servidor respondio ${res.status}`);
          const ct = res.headers.get('content-type') || '';
          if (!ct.startsWith('text/event-stream')) {
            throw new Error(`Respuesta inesperada del servidor (${ct || 'sin content-type'})`);
          }
        },
        onmessage(ev) {
          if (ev.event === 'done') ctrl.abort();
        },
        // Sin esto, fetchEventSource reintenta cada segundo hasta que vence el
        // abort de 330 s: un backend caido dejaba la tarjeta en "Escaneando..."
        // durante cinco minutos y medio. Relanzar corta el reintento y cae en
        // el catch/finally de abajo.
        onerror(err) {
          throw err;
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.error(`Escaneo de ${moduleKey}:`, err);
    } finally {
      clearTimeout(timeout);
      setScanning((prev) => ({ ...prev, [moduleKey]: false }));
      onRefreshStatus();
    }
  }, [scanning, onRefreshStatus]);

  if (loading) {
    return (
      <div className="dashboard-grid">
        {MODULE_KEYS.slice(0, 6).map((key) => (
          <div key={key} className="glass-panel module-card" data-span={MODULES[key].span} style={{ minHeight: 220, padding: 'var(--space-5)' }}>
            <div className="skeleton" style={{ width: '55%', height: 20, marginBottom: 'var(--space-5)' }} />
            <div className="skeleton" style={{ width: '100%', height: 14, marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ width: '85%', height: 14, marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ width: '92%', height: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-wrapper glass-panel">
        <span className="error-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <h2>No se pudo conectar con el backend</h2>
        {/* La direccion sale de donde el navegador realmente pide, no de un
            127.0.0.1:3001 hardcodeado: el puerto es configurable por PORT y en
            dev la app vive en el 5173 con proxy. `new URL` resuelve tanto el
            API_BASE relativo actual como uno absoluto si algun dia cambia. */}
        <p style={{ margin: 0 }}>
          El servidor local en {new URL(API_BASE, window.location.origin).origin} no está respondiendo.
        </p>
        <button className="btn btn-secondary" onClick={onRefreshStatus}>Reintentar</button>
      </div>
    );
  }

  const chartData = (systemStatus?.startup?.bootHistory || [])
    .filter((d) => d.boot_time_ms > 0)
    .map((d) => ({ fecha: d.date, tiempo: parseFloat((d.boot_time_ms / 1000).toFixed(2)) }));

  const visible = order.filter((id) => !hidden.includes(id));

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Estado del equipo</h1>
          <p style={{ margin: 0, color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
            Todo corre localmente. Ningún dato sale de esta máquina.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setCustomizing((v) => !v)}
          aria-expanded={customizing}
          aria-controls="panel-personalizar"
        >
          {customizing ? 'Listo' : 'Personalizar'}
        </button>
      </header>

      {customizing && (
        <div className="glass-panel" id="panel-personalizar" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          {order.map((id, i) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-1) 0' }}>
              <button
                className="btn btn-sm" disabled={i === 0}
                onClick={() => moveModule(id, -1)}
                aria-label={`Subir ${MODULES[id].label}`}
              >↑</button>
              <button
                className="btn btn-sm" disabled={i === order.length - 1}
                onClick={() => moveModule(id, 1)}
                aria-label={`Bajar ${MODULES[id].label}`}
              >↓</button>
              <label className="checkbox-item" style={{ flex: 1 }}>
                <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggleHidden(id)} />
                <span className="checkbox-label">{MODULES[id].label}</span>
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        {visible.map((key, i) => (
          <ModuleCard
            key={key}
            moduleKey={key}
            data={systemStatus?.[key]}
            scanning={!!scanning[key]}
            onScan={handleScan}
            onOpen={(k) => navigate(`/report/${k}`)}
            revealIndex={i}
          />
        ))}

        {chartData.length > 0 && (
          <div className="glass-panel chart-card reveal" style={{ '--reveal-index': visible.length }}>
            <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
              Tiempo de arranque
            </h2>
            <Suspense fallback={<div className="skeleton" style={{ height: 220 }} />}>
              <BootChart data={chartData} />
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}
