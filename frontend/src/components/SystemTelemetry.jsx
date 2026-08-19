import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

/**
 * Indicador de tono según el porcentaje de uso (0-100).
 */
function getUsageTone(pct) {
  if (pct >= 85) return 'is-danger';
  if (pct >= 65) return 'is-warning';
  return 'is-success';
}

export default function SystemTelemetry() {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchTelemetry = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/system/metrics`);
      if (!res.ok) throw new Error('No se pudo obtener la telemetría del sistema');
      const data = await res.json();
      setTelemetry(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let interval = null;

    const load = async () => {
      if (alive && !document.hidden) await fetchTelemetry();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && alive) {
        fetchTelemetry();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    load();
    interval = setInterval(load, 5000);

    return () => {
      alive = false;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchTelemetry]);

  if (loading && !telemetry) {
    return (
      <section className="glass-panel telemetry-widget" aria-label="Telemetría en tiempo real" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div className="skeleton" style={{ width: '30%', height: 20 }} />
          <div className="skeleton" style={{ width: '15%', height: 20 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 90 }} />
        </div>
      </section>
    );
  }

  if (error && !telemetry) {
    return null; // Omitir silenciosamente si el endpoint no responde
  }

  const cpuPct = telemetry?.cpu?.usagePercent ?? 0;
  const ramPct = telemetry?.ram?.usagePercent ?? 0;
  const disks = telemetry?.disks || [];

  return (
    <section
      className="glass-panel telemetry-widget"
      aria-labelledby="telemetry-title"
      style={{
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: error ? 'var(--color-warning)' : 'var(--color-success)',
              boxShadow: error ? '0 0 8px var(--color-warning)' : '0 0 8px var(--color-success)',
            }}
          />
          <h2 id="telemetry-title" style={{ fontSize: 'var(--text-base)', margin: 0, fontWeight: 600 }}>
            {error ? 'Telemetría de Hardware (Desactualizada)' : 'Telemetría de Hardware en Vivo'}
          </h2>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', marginLeft: 'var(--space-2)' }}>
            Uptime: {telemetry?.system?.uptimeFormatted || '—'}
          </span>
        </div>

        <button
          className="btn btn-quiet btn-sm"
          onClick={() => fetchTelemetry(true)}
          disabled={refreshing}
          title="Actualizar métricas ahora"
          aria-label="Actualizar métricas en tiempo real"
        >
          {refreshing ? 'Actualizando…' : 'Refrescar'}
        </button>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {/* Medidor CPU */}
        <div
          className="glass-panel"
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-surface-panel)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', fontWeight: 500 }}>
              CPU ({telemetry?.cpu?.cores} Núcleos)
            </span>
            <span className={`metric-value ${getUsageTone(cpuPct)}`} style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              {cpuPct}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 6,
              backgroundColor: 'var(--color-border-subtle)',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 'var(--space-2)',
            }}
          >
            <div
              style={{
                width: `${cpuPct}%`,
                height: '100%',
                backgroundColor: cpuPct >= 85 ? 'var(--color-danger)' : cpuPct >= 65 ? 'var(--color-warning)' : 'var(--color-accent)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {telemetry?.cpu?.model || 'Procesador'}
          </div>
        </div>

        {/* Medidor RAM */}
        <div
          className="glass-panel"
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-surface-panel)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', fontWeight: 500 }}>
              Memoria RAM
            </span>
            <span className={`metric-value ${getUsageTone(ramPct)}`} style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              {ramPct}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 6,
              backgroundColor: 'var(--color-border-subtle)',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 'var(--space-2)',
            }}
          >
            <div
              style={{
                width: `${ramPct}%`,
                height: '100%',
                backgroundColor: ramPct >= 85 ? 'var(--color-danger)' : ramPct >= 65 ? 'var(--color-warning)' : 'var(--color-accent)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{telemetry?.ram?.usedGB} GB en uso</span>
            <span>{telemetry?.ram?.freeGB} GB libres ({telemetry?.ram?.totalGB} GB total)</span>
          </div>
        </div>

        {/* Unidades de Almacenamiento */}
        <div
          className="glass-panel"
          style={{
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-surface-panel)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', fontWeight: 500 }}>
              Almacenamiento Local
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
              {disks.length} {disks.length === 1 ? 'unidad' : 'unidades'}
            </span>
          </div>

          {disks.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
              Consultando unidades...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {disks.map((d) => (
                <div key={d.drive} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ fontWeight: 600 }}>{d.drive} {d.volumeName ? `(${d.volumeName})` : ''}</span>
                    <span style={{ color: 'var(--color-ink-3)' }}>
                      {d.freeGB} GB libres / {d.totalGB} GB ({d.usagePercent}%)
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: 4,
                      backgroundColor: 'var(--color-border-subtle)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${d.usagePercent}%`,
                        height: '100%',
                        backgroundColor: d.usagePercent >= 90 ? 'var(--color-danger)' : d.usagePercent >= 75 ? 'var(--color-warning)' : 'var(--color-accent)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
