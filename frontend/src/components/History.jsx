import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODULES } from '../modules';
import { API_BASE } from '../config';
import { ModuleIcon } from './ModuleIcon';

/**
 * Formatea métricas resumidas de un snapshot según su módulo.
 */
function renderTimelineSummary(moduleKey, counts = {}) {
  if (!counts) return 'Escaneo completado';

  switch (moduleKey) {
    case 'cleanup':
      return counts.total_recoverable_mb != null
        ? `${counts.total_recoverable_mb >= 1024 ? (counts.total_recoverable_mb / 1024).toFixed(2) + ' GB' : counts.total_recoverable_mb + ' MB'} detectados`
        : 'Escaneo de disco finalizado';
    case 'updates':
      return counts.total != null
        ? `${counts.total} ${counts.total === 1 ? 'actualización pendiente' : 'actualizaciones pendientes'}`
        : 'Revisión de paquetes finalizada';
    case 'startup':
      return `${(counts.programs || 0) + (counts.tasks || 0)} elementos de inicio`;
    case 'ram':
      return counts.processesScanned
        ? `${counts.processesScanned} procesos analizados`
        : 'Diagnóstico de memoria finalizado';
    case 'apps':
      return counts.totalApps != null
        ? `${counts.totalApps} aplicaciones instaladas`
        : 'Catálogo de winget actualizado';
    case 'privacy':
      return counts.exposedCount != null
        ? `${counts.exposedCount} ajustes expuestos`
        : 'Auditoría de privacidad finalizada';
    case 'services':
      return counts.thirdParty != null
        ? `${counts.thirdParty} servicios de terceros detectados`
        : 'Servicios analizados';
    case 'adblock':
      return counts.rulesCount != null
        ? `${counts.rulesCount} reglas de bloqueo activas`
        : 'Hosts auditados';
    default:
      return 'Reporte generado con éxito';
  }
}

export default function History() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('changes'); // 'changes' | 'timeline'
  const [changes, setChanges] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const [selectedModuleFilter, setSelectedModuleFilter] = useState('all');

  const fetchChanges = useCallback(async () => {
    const res = await fetch(`${API_BASE}/changes`);
    if (!res.ok) throw new Error('No se pudo leer el historial de cambios');
    return (await res.json()).changes;
  }, []);

  const fetchTimeline = useCallback(async () => {
    const res = await fetch(`${API_BASE}/timeline`);
    if (!res.ok) throw new Error('No se pudo leer la línea de tiempo de escaneos');
    return await res.json();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cData, tData] = await Promise.all([fetchChanges(), fetchTimeline()]);
      setChanges(cData || []);
      setTimeline(tData || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchChanges, fetchTimeline]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const undo = async (change) => {
    setUndoing(`${change.module}-${change.id}`);
    try {
      const res = await fetch(`${API_BASE}/changes/${change.module}/${change.id}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo deshacer');
      setChanges(await fetchChanges());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setUndoing(null);
    }
  };

  const filteredTimeline = timeline.filter((item) => {
    if (selectedModuleFilter === 'all') return true;
    return item.module === selectedModuleFilter;
  });

  return (
    <>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>Historial y Auditoría</h1>
            <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
              Registro inmutable de cambios aplicados al sistema y cronología de escaneos.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className={`btn btn-sm ${tab === 'changes' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('changes')}
            >
              Diario de Cambios ({changes.length})
            </button>
            <button
              className={`btn btn-sm ${tab === 'timeline' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('timeline')}
            >
              Línea de Tiempo de Escaneos ({timeline.length})
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="glass-panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)', color: 'var(--color-danger)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-panel" style={{ padding: 'var(--space-6)' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 44, marginBottom: 'var(--space-3)' }} />
          ))}
        </div>
      ) : tab === 'changes' ? (
        /* PESTAÑA: DIARIO DE CAMBIOS */
        changes.length === 0 ? (
          <div className="empty-wrapper glass-panel">
            <h2>Todavía no hay cambios registrados</h2>
            <p style={{ margin: 0 }}>Cuando ejecutes una acción, cada cambio quedará registrado acá con su estado de reversibilidad.</p>
          </div>
        ) : (
          <div className="glass-panel" style={{ overflowX: 'auto' }}>
            <table className="scheduler-table">
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Módulo</th>
                  <th scope="col">Qué se hizo</th>
                  <th scope="col">Antes</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const key = `${c.module}-${c.id}`;
                  const isUndoing = undoing === key;
                  const modLabel = MODULES[c.module]?.label || c.module;
                  return (
                    <tr key={key}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                        {c.timestamp}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{modLabel}</span>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {c.action}
                        {c.detail ? <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>{c.detail}</div> : null}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                        {c.previousValue !== undefined ? JSON.stringify(c.previousValue) : '—'}
                      </td>
                      <td>
                        {c.undone ? (
                          <span className="badge badge-neutral">Deshecho</span>
                        ) : c.reversible ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => undo(c)}
                            disabled={isUndoing}
                          >
                            {isUndoing ? 'Deshaciendo…' : 'Deshacer'}
                          </button>
                        ) : (
                          <span className="badge badge-warning" title="Esta acción no se puede revertir automáticamente">
                            Irreversible
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* PESTAÑA: LÍNEA DE TIEMPO DE ESCANEOS */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)' }}>
              Mostrando {filteredTimeline.length} de {timeline.length} escaneos
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <label htmlFor="filter-module" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                Filtrar por módulo:
              </label>
              <select
                id="filter-module"
                className="input-field"
                value={selectedModuleFilter}
                onChange={(e) => setSelectedModuleFilter(e.target.value)}
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  backgroundColor: 'var(--color-surface-panel)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-ink-1)',
                }}
              >
                <option value="all">Todos los módulos</option>
                {Object.entries(MODULES).map(([key, mod]) => (
                  <option key={key} value={key}>{mod.label}</option>
                ))}
              </select>
            </div>
          </div>

          {filteredTimeline.length === 0 ? (
            <div className="empty-wrapper glass-panel">
              <h2>No hay escaneos en la línea de tiempo</h2>
              <p style={{ margin: 0 }}>Ejecuta un escaneo en cualquier módulo desde el Dashboard para ver su evolución acá.</p>
            </div>
          ) : (
            <div className="glass-panel" style={{ overflowX: 'auto' }}>
              <table className="scheduler-table">
                <thead>
                  <tr>
                    <th scope="col">Fecha y Hora</th>
                    <th scope="col">Módulo</th>
                    <th scope="col">Diagnóstico y Métricas</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimeline.map((item) => {
                    const mod = MODULES[item.module];
                    const label = mod?.label || item.module;
                    const summary = renderTimelineSummary(item.module, item.counts);

                    return (
                      <tr key={item.id}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                          {item.timestamp || item.date}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            {mod?.icon && <ModuleIcon path={mod.icon} size={14} />}
                            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{label}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 'var(--text-sm)' }}>
                          <span style={{ color: 'var(--color-ink-1)', fontWeight: 500 }}>
                            {summary}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            onClick={() => navigate(`/report/${item.module}`)}
                            title={`Abrir reporte de ${label}`}
                          >
                            Ver Reporte →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
