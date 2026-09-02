import { useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODULES, MODULE_KEYS } from '../modules';
import { ModuleIcon } from './ModuleIcon';
import SystemTelemetry from './SystemTelemetry';
import HealthScoreCard from './HealthScoreCard';
import ProfilesSelector from './ProfilesSelector';
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
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next, hidden);
    setOrder(next);
  };

  const toggleHidden = (id) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    persist(order, next);
    setHidden(next);
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

  const handleScan = useCallback(async (moduleKey) => {
    let wasScanning = false;
    setScanning((prev) => {
      if (prev[moduleKey]) {
        wasScanning = true;
        return prev;
      }
      return { ...prev, [moduleKey]: true };
    });
    if (wasScanning) return;

    let abortReason = null;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => {
      abortReason = 'timeout';
      ctrl.abort();
    }, 330000);

    try {
      const response = await fetch(`${API_BASE}/scan/${moduleKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: ctrl.signal,
      });

      if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No se pudo inicializar la lectura del stream SSE');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event: done')) {
            abortReason = 'done';
            break;
          }
        }
        if (abortReason === 'done') break;
      }
    } catch (err) {
      if (abortReason === 'timeout') {
        console.error(`Escaneo de ${moduleKey}: tiempo de espera agotado (330s)`);
      } else if (abortReason !== 'done' && err.name !== 'AbortError') {
        console.error(`Escaneo de ${moduleKey}:`, err);
      }
    } finally {
      clearTimeout(timeout);
      setScanning((prev) => ({ ...prev, [moduleKey]: false }));
      onRefreshStatus();
    }
  }, [onRefreshStatus]);

  if (loading) {
    return (
      <div className="dashboard-grid">
        {MODULE_KEYS.slice(0, 6).map((key) => (
          <div key={key} className="glass-panel module-card" data-span={MODULES[key].span} style={{ minHeight: 220, padding: 'var(--space-5)' }}>
            <div className="skeleton" style={{ width: '40%', height: 20, marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ width: '70%', height: 14, marginBottom: 'var(--space-5)' }} />
            <div className="skeleton" style={{ width: '100%', height: 60 }} />
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
            Todo corre localmente y ningún dato tuyo sale de esta máquina. La
            única salida a internet es la descarga de listas del módulo de
            anuncios, y solo cuando vos la pedís.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <a
            className="btn btn-secondary"
            href={`${API_BASE}/system/export?format=markdown`}
            download
            title="Exportar informe técnico del sistema en Markdown"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar Informe (.md)
          </a>
          <button
            className="btn btn-secondary"
            onClick={() => setCustomizing((v) => !v)}
            aria-expanded={customizing}
            aria-controls="panel-personalizar"
          >
            {customizing ? 'Listo' : 'Personalizar'}
          </button>
        </div>
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

      <HealthScoreCard onOptimized={onRefreshStatus} />

      <ProfilesSelector onProfileApplied={onRefreshStatus} />

      <SystemTelemetry />

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
