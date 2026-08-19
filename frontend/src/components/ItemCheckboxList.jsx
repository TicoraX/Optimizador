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
  if (!items || items.length === 0) return null;

  const visibleItems = filterFn ? items.filter(filterFn) : items;

  // Para checkboxes con clave por regPath (contextmenu) o por índice
  const getKey = (item, idx) => item.regPath || item.id || idx;
  const getChecked = (item, idx) => {
    // contextmenu usa regPath como clave
    if (item.regPath && selected[item.regPath] !== undefined) {
      return selected[item.regPath] || false;
    }
    return selected[idx] || false;
  };
  const handleToggle = (item, idx) => {
    if (item.regPath && selected[item.regPath] !== undefined) {
      toggle(item.regPath);
    } else {
      toggle(idx);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {hint && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
          {hint}
        </p>
      )}
      <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {visibleItems.map((item, idx) => {
          const display = renderItem
            ? renderItem(item, idx)
            : { title: item.name, subtitle: item.desc || item.status || '' };

          return (
            <label key={getKey(item, idx)} className="checkbox-item">
              <input
                type="checkbox"
                checked={getChecked(item, idx)}
                onChange={() => handleToggle(item, idx)}
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
        })}
      </div>
    </div>
  );
}
