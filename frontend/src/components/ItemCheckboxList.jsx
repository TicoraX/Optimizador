import { useState, useMemo } from 'react';

/**
 * Lista de checkboxes reutilizable para los paneles de módulos genéricos.
 *
 * Reemplaza ~15 bloques idénticos en ReportViewer.jsx. Cada módulo solo
 * necesita definir `label`, `hint`, `renderItem` (opcional) y la lógica
 * de selección viene del hook useModuleItems.
 */

/**
 * @param {{ items, selected, toggle, isRunning, label, hint, renderItem? }} props
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

  if (!items || items.length === 0) return null;

  // Para checkboxes con clave por regPath (contextmenu) o por índice
  const getKey = (item, originalIndex) => item.regPath || item.id || originalIndex;
  const getChecked = (item, originalIndex) => {
    // contextmenu usa regPath como clave
    if (item.regPath && selected[item.regPath] !== undefined) {
      return selected[item.regPath] || false;
    }
    return selected[originalIndex] || false;
  };
  const handleToggle = (item, originalIndex) => {
    if (item.regPath && selected[item.regPath] !== undefined) {
      toggle(item.regPath);
    } else {
      toggle(originalIndex);
    }
  };

  return (
    <div className="form-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
        {baseEntries.length > 5 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
            {visibleEntries.length} de {baseEntries.length}
          </span>
        )}
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
