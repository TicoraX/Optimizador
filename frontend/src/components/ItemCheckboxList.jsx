import { useState, useMemo } from 'react';

/**
 * Lista de checkboxes reutilizable para los paneles de módulos genéricos.
 *
 * Reemplaza ~15 bloques idénticos en ReportViewer.jsx. Cada módulo solo
 * necesita definir `label`, `hint`, `renderItem` (opcional) y la lógica
 * de selección viene del hook useModuleItems.
 */

/**
 * @param {{ items, selected, toggle, isRunning, label, hint, renderItem?, filterFn?, onSelectAll?, onDeselectAll? }} props
 * `renderItem` opcional: (item, idx) => { title, subtitle, statusColor }.
 * Si no se pasa, usa item.name + item.desc como default.
 */
export default function ItemCheckboxList({
  items,
  selected,
  toggle,
  isRunning,
  label,
  hint,
  renderItem,
  filterFn,
  onSelectAll,
  onDeselectAll,
}) {
  const [search, setSearch] = useState('');

  const baseEntries = useMemo(() => {
    if (!items || items.length === 0) return [];
    return items
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item, originalIndex }) => (filterFn ? filterFn(item, originalIndex) : true));
  }, [items, filterFn]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseEntries;
    return baseEntries.filter(({ item }) => {
      const name = String(item.name || item.id || item.regPath || '').toLowerCase();
      const desc = String(item.desc || item.status || item.command || '').toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [baseEntries, search]);

  if (!items || items.length === 0) {
    return (
      <div className="form-group">
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
        {hint && (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem', marginTop: '0.25rem' }}>
            {hint}
          </p>
        )}
        <div style={{
          padding: 'var(--space-4)',
          background: 'var(--color-paper-2)',
          border: '1px dashed var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm, 6px)',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--color-ink-3)',
          marginTop: '0.5rem',
        }}>
          No hay elementos escaneados aún. Ejecutá un escaneo para analizar este módulo.
        </div>
      </div>
    );
  }

  // Para checkboxes identificados por su índice original del array de items
  const getKey = (item, originalIndex) => item.regPath || item.id || item.name || originalIndex;
  const getChecked = (_item, originalIndex) => selected[originalIndex] || false;
  const handleToggle = (_item, originalIndex) => toggle(originalIndex);

  return (
    <div className="form-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {baseEntries.length > 5 && (
            <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-3)', marginRight: '0.25rem' }}>
              {visibleEntries.length} de {baseEntries.length}
            </span>
          )}
          {onSelectAll && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', width: 'auto' }}
              onClick={onSelectAll}
              disabled={isRunning}
            >
              Todos
            </button>
          )}
          {onDeselectAll && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', width: 'auto' }}
              onClick={onDeselectAll}
              disabled={isRunning}
            >
              Ninguno
            </button>
          )}
        </div>
      </div>

      {hint && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
          {hint}
        </p>
      )}

      {baseEntries.length > 5 && (
        <div style={{ position: 'relative', marginBottom: 'var(--space-2)' }}>
          <input
            type="text"
            className="input input-sm"
            placeholder="Filtrar por nombre o detalle..."
            aria-label="Filtrar por nombre o detalle"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isRunning}
            style={{
              width: '100%',
              fontSize: '0.75rem',
              padding: '0.35rem 0.6rem',
              backgroundColor: 'var(--color-paper-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm, 6px)',
              color: 'var(--color-ink)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--color-ink-3)',
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
              title="Limpiar filtro"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {visibleEntries.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-ink-3)' }}>
            No hay elementos que coincidan con "{search}"
          </div>
        ) : (
          visibleEntries.map(({ item, originalIndex }) => {
            const display = renderItem
              ? renderItem(item, originalIndex)
              : { title: item.name, subtitle: item.desc || item.status || '' };

            return (
              <label key={getKey(item, originalIndex)} className="checkbox-item">
                <input
                  type="checkbox"
                  checked={getChecked(item, originalIndex)}
                  onChange={() => handleToggle(item, originalIndex)}
                  disabled={isRunning}
                />
                <span className="checkbox-label" title={display.title}>
                  {display.prefix && (
                    <strong style={{ color: 'var(--color-brand)' }}>[{display.prefix}] </strong>
                  )}
                  {display.title}
                  {display.subtitle && (
                    <span style={{
                      display: 'block',
                      fontSize: '0.7rem',
                      color: display.statusColor || 'var(--color-ink-3)',
                    }}>
                      {display.subtitle}
                    </span>
                  )}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
