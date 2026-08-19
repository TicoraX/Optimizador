import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

export default function HealthScoreCard({ onOptimized }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dryRun, setDryRun] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchHealthScore = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/health-score`);
      if (!res.ok) throw new Error('Error al obtener el diagnóstico global');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthScore();
  }, [fetchHealthScore]);

  const handleQuickOptimize = async () => {
    if (!data?.quickFixes?.length) return;
    setExecuting(true);
    setExecutionResult(null);

    try {
      const res = await fetch(`${API_BASE}/quick-optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          actions: data.quickFixes.map((f) => f.id),
        }),
      });

      if (!res.ok) throw new Error('Error ejecutando optimización rápida');
      const result = await res.json();
      setExecutionResult(result);
      if (!dryRun) {
        await fetchHealthScore();
        if (onOptimized) onOptimized();
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="glass-panel" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <div className="skeleton" style={{ height: 110 }} />
      </div>
    );
  }

  if (error && !data) {
    return null; // Silencioso si falla la primera vez
  }

  const score = data?.score ?? 100;
  const grade = data?.grade ?? 'Excelente';
  const badgeTone = data?.badgeTone ?? 'is-success';

  // Color del score radial / gauge
  const getScoreColor = (s) => {
    if (s >= 90) return 'var(--color-success)';
    if (s >= 75) return 'var(--color-accent)';
    if (s >= 50) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  const scoreColor = getScoreColor(score);

  return (
    <div
      className="glass-panel health-score-card"
      style={{
        padding: 'var(--space-5) var(--space-6)',
        marginBottom: 'var(--space-6)',
        borderLeft: `4px solid ${scoreColor}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-6)',
        }}
      >
        {/* Lado Izquierdo: Medidor Radial / Score Principal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: '50%',
              background: `radial-gradient(closest-side, var(--color-surface-panel) 78%, transparent 80% 100%), conic-gradient(${scoreColor} ${score}%, var(--color-border-subtle) 0)`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--color-ink-3)', marginTop: 2 }}>/100</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>Salud del Sistema</h2>
              <span className={`badge ${badgeTone}`} style={{ fontSize: '11px' }}>
                {grade}
              </span>
            </div>
            <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
              {data?.quickFixes?.length
                ? `${data.quickFixes.length} optimizaciones recomendadas para máxima eficiencia.`
                : 'Tu sistema se encuentra en estado óptimo.'}
            </p>
          </div>
        </div>

        {/* Centro: Desglose de Pilares en Mini-Barras */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(110px, 1fr))',
            gap: 'var(--space-3) var(--space-4)',
            flex: 1,
            maxWidth: 480,
          }}
        >
          {data?.breakdown?.map((b) => {
            const maxVal = Number(b.max) || 0;
            const scoreVal = Number(b.score) || 0;
            const pct = maxVal > 0 ? Math.min(100, Math.max(0, Math.round((scoreVal / maxVal) * 100))) : 0;
            return (
              <div key={b.category} style={{ minWidth: 100 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: 2 }}>
                  <span style={{ color: 'var(--color-ink-2)' }}>{b.category}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--color-border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: getScoreColor(pct),
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Lado Derecho: Acciones Rápidas */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <label
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-ink-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={executing}
              />
              Simular
            </label>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleQuickOptimize}
              disabled={executing || (data?.quickFixes?.length ?? 0) === 0}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
              }}
            >
              {executing
                ? 'Optimizando…'
                : (data?.quickFixes?.length ?? 0) > 0
                  ? `Optimizar Todo (${data.quickFixes.length})`
                  : 'Sistema Óptimo'}
            </button>
          </div>

          {data?.quickFixes?.length > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowDetails((v) => !v)}
              style={{
                fontSize: '11px',
                color: 'var(--color-accent)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showDetails ? 'Ocultar sugerencias ▲' : 'Ver qué se optimizará ▼'}
            </button>
          )}
        </div>
      </div>

      {/* Panel Desplegable de Sugerencias */}
      {showDetails && data?.quickFixes?.length > 0 && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-rule)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {data.quickFixes.map((fix) => (
            <div
              key={fix.id}
              style={{
                background: 'var(--color-surface-panel)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--color-ink-1)' }}>
                {fix.title}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-ink-3)', marginTop: 2 }}>
                {fix.desc}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--color-danger)',
            color: 'var(--color-danger)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {error}
        </div>
      )}

      {/* Resultados de Ejecución Rápida */}
      {executionResult && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: executionResult.dryRun ? 'rgba(56, 189, 248, 0.1)' : 'rgba(34, 197, 94, 0.1)',
            border: `1px solid ${executionResult.dryRun ? 'var(--color-accent)' : 'var(--color-success)'}`,
            fontSize: 'var(--text-xs)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {executionResult.dryRun ? 'ℹ Simulación completada' : '✓ Optimización rápida finalizada'}: {executionResult.executedCount} módulos procesados.
          </div>
          {executionResult.results?.map((r) => (
            <div key={r.id} style={{ color: 'var(--color-ink-2)', marginLeft: 'var(--space-2)' }}>
              • <strong>{r.module}</strong>: {r.success ? 'Completado' : `Fallo: ${r.error}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
