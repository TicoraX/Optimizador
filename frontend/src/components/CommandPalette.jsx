import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODULES, MODULE_KEYS } from '../modules';
import { ModuleIcon } from './ModuleIcon';
import { API_BASE } from '../config';

export default function CommandPalette({ isOpen, onClose, onToggleTheme, theme }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const prevActiveElementRef = useRef(null);
  const focusTimerRef = useRef(null);
  const navigate = useNavigate();

  // Elementos de la paleta
  const allItems = useMemo(() => {
    const mainViews = [
      { id: 'view-dashboard', label: 'Dashboard Principal', section: 'Navegación', path: '/', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', keywords: 'inicio home resumen estado' },
      { id: 'view-history', label: 'Historial de Cambios & Rollback', section: 'Navegación', path: '/historial', icon: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2', keywords: 'undo revertir cambios diario' },
      { id: 'view-restore', label: 'Puntos de Restauración de Windows', section: 'Navegación', path: '/restauracion', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', keywords: 'backup restorepoint snapshot recuperar' },
      { id: 'view-largefiles', label: 'Cazador de Archivos Grandes', section: 'Navegación', path: '/archivos-grandes', icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', keywords: 'disco espacio gigas limpiar pesados' },
      { id: 'view-scheduler', label: 'Programador de Tareas', section: 'Navegación', path: '/scheduler', icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', keywords: 'cron semanal automatizar tareas' },
    ];

    const moduleViews = MODULE_KEYS.map((key) => {
      const mod = MODULES[key];
      return {
        id: `mod-${key}`,
        label: mod.label,
        section: 'Módulos de Optimización',
        path: `/report/${key}`,
        icon: mod.icon,
        desc: mod.blurb,
        keywords: `${key} ${mod.label} ${mod.blurb || ''}`.toLowerCase(),
      };
    });

    const actions = [
      {
        id: 'act-export-md',
        label: 'Exportar Informe Completo del Sistema (.md)',
        section: 'Acciones Rápidas',
        icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
        action: () => {
          window.location.href = `${API_BASE}/system/export?format=markdown`;
        },
        keywords: 'descargar exportar informe markdown reporte',
      },
      {
        id: 'act-export-json',
        label: 'Exportar Informe Completo del Sistema (.json)',
        section: 'Acciones Rápidas',
        icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
        action: () => {
          window.location.href = `${API_BASE}/system/export?format=json`;
        },
        keywords: 'descargar exportar json datos telemetria',
      },
      {
        id: 'act-theme',
        label: `Cambiar a ${theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}`,
        section: 'Acciones Rápidas',
        icon: theme === 'dark'
          ? 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'
          : 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
        action: () => {
          onToggleTheme?.();
        },
        keywords: 'tema color oscuro claro dark light theme',
      },
    ];

    return [...mainViews, ...moduleViews, ...actions];
  }, [theme, onToggleTheme]);

  // Filtrado reactivo por texto
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((item) => (
      item.label.toLowerCase().includes(q) ||
      (item.keywords && item.keywords.includes(q)) ||
      (item.desc && item.desc.toLowerCase().includes(q))
    ));
  }, [allItems, query]);

  // Reset del índice al cambiar la búsqueda
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Gestión de foco y accesibilidad al abrir / cerrar el modal
  useEffect(() => {
    if (isOpen) {
      prevActiveElementRef.current = document.activeElement;
      setQuery('');
      setSelectedIndex(0);
      focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
    } else if (prevActiveElementRef.current && typeof prevActiveElementRef.current.focus === 'function') {
      prevActiveElementRef.current.focus();
    }
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, [isOpen]);

  const handleSelect = (item) => {
    if (!item) return;
    onClose();
    if (item.action) {
      item.action();
    } else if (item.path) {
      navigate(item.path);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        handleSelect(filteredItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="command-palette-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        className="glass-panel command-palette-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: '90%',
          maxWidth: '620px',
          maxHeight: '70vh',
          backgroundColor: 'var(--color-paper-2)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Barra de Búsqueda */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar módulo, herramienta o acción… (ej. RAM, DNS, Tema, Backup)"
            aria-label="Buscar comandos, módulos o acciones"
            aria-autocomplete="list"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-ink)',
              fontSize: 'var(--text-base)',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: '0.7rem',
              color: 'var(--color-ink-3)',
              padding: '2px 6px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
            }}
            title="Cerrar paleta"
          >
            ESC
          </button>
        </div>

        {/* Lista de Resultados */}
        <div
          role="listbox"
          aria-label="Resultados de búsqueda"
          className="command-palette-results"
          style={{
            overflowY: 'auto',
            padding: 'var(--space-2)',
            maxHeight: 'calc(70vh - 70px)',
          }}
        >
          {filteredItems.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-ink-3)' }}>
              No se encontraron coincidencias para "{query}"
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`command-palette-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(item);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-md, 8px)',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'var(--color-paper-3)' : 'transparent',
                    border: isSelected ? '1px solid var(--color-border-subtle)' : '1px solid transparent',
                    transition: 'background-color 0.15s ease',
                    outline: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                    <span style={{ color: isSelected ? 'var(--color-brand, #38bdf8)' : 'var(--color-ink-3)', display: 'flex' }} aria-hidden="true">
                      <ModuleIcon path={item.icon} size={18} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: isSelected ? 600 : 500, color: 'var(--color-ink)', fontSize: 'var(--text-sm)' }}>
                        {item.label}
                      </div>
                      {item.desc && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.desc}
                        </div>
                      )}
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--color-ink-3)',
                      backgroundColor: 'var(--color-paper)',
                      padding: '2px 8px',
                      borderRadius: 12,
                      whiteSpace: 'nowrap',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    {item.section}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
