import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const CATEGORY_COLORS = {
  temp: 'var(--color-accent, #3b82f6)',
  windowsUpdate: '#06b6d4',
  crashDumps: '#8b5cf6',
  devCache: '#10b981',
  shaderCache: '#f59e0b',
  browserCache: '#ec4899',
  thumbnails: '#6366f1',
  recycle: '#ef4444',
  downloads: '#f97316',
};

const fmtSize = (mb) => {
  if (mb == null || mb === 0) return '0 MB';
  return mb < 1024 ? `${Number(mb).toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
};

export default function CleanupBreakdownChart({
  categories = [],
  selected = {},
  onToggleCategory,
  onSelectAllSafe,
  onDeselectAll,
}) {
  const chartData = useMemo(() => {
    return categories
      .filter((c) => (c.sizeMB || 0) > 0)
      .map((c) => ({
        key: c.key,
        name: c.label || c.key,
        sizeMB: Math.round((c.sizeMB || 0) * 10) / 10,
        safety: c.safety,
        selected: !!selected[c.key],
        color: CATEGORY_COLORS[c.key] || 'var(--color-accent)',
      }))
      .sort((a, b) => b.sizeMB - a.sizeMB);
  }, [categories, selected]);

  const totalRecoverableMB = useMemo(() => {
    return categories.reduce((sum, c) => sum + (c.sizeMB || 0), 0);
  }, [categories]);

  const totalSelectedMB = useMemo(() => {
    return categories
      .filter((c) => selected[c.key])
      .reduce((sum, c) => sum + (c.sizeMB || 0), 0);
  }, [categories, selected]);

  if (categories.length === 0) return null;

  return (
    <section
      className="glass-panel cleanup-breakdown"
      aria-labelledby="cleanup-chart-title"
      style={{
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
        }}
      >
        <div>
          <h2 id="cleanup-chart-title" style={{ fontSize: 'var(--text-lg)', margin: 0, fontWeight: 600 }}>
            Desglose de Espacio Recuperable
          </h2>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)', marginTop: 'var(--space-1)' }}>
            Total detectado: <strong style={{ color: 'var(--color-ink-1)' }}>{fmtSize(totalRecoverableMB)}</strong>
            {' · '}
            Seleccionado para liberar: <strong style={{ color: totalSelectedMB > 0 ? 'var(--color-accent)' : 'var(--color-ink-3)' }}>{fmtSize(totalSelectedMB)}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onSelectAllSafe}
            title="Selecciona todas las categorías marcadas como SAFE"
          >
            Seleccionar Seguros (SAFE)
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={onDeselectAll}
          >
            Deseleccionar
          </button>
        </div>
      </header>

      {/* Gráfico de barras horizontales si hay espacio detectado */}
      {chartData.length > 0 && (
        <div style={{ width: '100%', height: Math.max(160, chartData.length * 32), marginBottom: 'var(--space-5)' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
            >
              <XAxis
                type="number"
                unit=" MB"
                stroke="var(--color-ink-3)"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                stroke="var(--color-ink-2)"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const item = payload[0].payload;
                  return (
                    <div
                      className="glass-panel"
                      style={{
                        padding: 'var(--space-2) var(--space-3)',
                        fontSize: 'var(--text-xs)',
                        backgroundColor: 'var(--color-surface-panel)',
                        border: '1px solid var(--color-border-subtle)',
                        boxShadow: 'var(--shadow-md)',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ color: item.color, marginTop: 2 }}>{fmtSize(item.sizeMB)}</div>
                      <div style={{ color: 'var(--color-ink-3)', marginTop: 2 }}>
                        Nivel: {item.safety === 'SAFE' ? 'Seguro' : 'Precaución'}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="sizeMB"
                radius={[0, 4, 4, 0]}
                onClick={(entry) => onToggleCategory(entry.key)}
                style={{ cursor: 'pointer' }}
              >
                {chartData.map((entry) => (
                  <Cell
                    key={`cell-${entry.key}`}
                    fill={entry.selected ? entry.color : 'var(--color-border-subtle)'}
                    opacity={entry.selected ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Grid interactivo de Categorías */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        {categories.map((c) => {
          const isChecked = !!selected[c.key];
          const isCaution = c.safety === 'CAUTION';
          const dotColor = CATEGORY_COLORS[c.key] || 'var(--color-accent)';

          return (
            <label
              key={c.key}
              className="glass-panel checkbox-item"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                cursor: 'pointer',
                border: isChecked ? `1px solid ${dotColor}` : '1px solid var(--color-border-subtle)',
                backgroundColor: isChecked ? 'rgba(59, 130, 246, 0.05)' : 'var(--color-surface-panel)',
                transition: 'all 0.2s ease',
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleCategory(c.key)}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{c.label}</span>
                  <span
                    className={`badge badge-${isCaution ? 'warning' : 'neutral'}`}
                    style={{ fontSize: '10px', padding: '1px 6px' }}
                  >
                    {c.safety === 'SAFE' ? 'Seguro' : 'Precaución'}
                  </span>
                </div>

                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', marginTop: 2 }}>
                  {c.hint}
                </div>

                {c.sizeMB !== undefined && (
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: dotColor, marginTop: 4 }}>
                    {fmtSize(c.sizeMB)} {c.count !== undefined ? `(${c.count} items)` : ''}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}
