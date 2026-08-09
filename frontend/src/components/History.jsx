import { useState, useEffect, useCallback } from 'react';
import { MODULES } from '../modules';
import { API_BASE } from '../config';

/**
 * Diario de todo lo que la app cambio en el sistema, con deshacer por fila.
 *
 * Cada fila muestra el valor anterior que se copio al aplicar el cambio, no
 * uno recalculado leyendo el sistema: la fila cuenta lo que paso ese dia.
 * Lo que no guardo valor anterior (un archivo borrado, una app desinstalada,
 * un proceso terminado) se marca como irreversible en vez de ofrecer un boton
 * que miente.
 */
export default function History() {
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(null);

  const fetchChanges = useCallback(async () => {
    const res = await fetch(`${API_BASE}/changes`);
    if (!res.ok) throw new Error('No se pudo leer el historial');
    return (await res.json()).changes;
  }, []);

  useEffect(() => {
    // `alive` evita setear estado si el usuario navega antes de que responda.
    let alive = true;
    (async () => {
      try {
        const data = await fetchChanges();
        if (alive) { setChanges(data); setError(null); }
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fetchChanges]);

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

  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: 'var(--space-6)' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, marginBottom: 'var(--space-3)' }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Historial de cambios</h1>
        <p style={{ margin: 0, color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
          Todo lo que la app modificó en el sistema, con el valor que tenía antes.
        </p>
      </header>

      {error && (
        <div className="glass-panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)', color: 'var(--color-danger)' }}>
          {error}
        </div>
      )}

      {changes.length === 0 ? (
        <div className="empty-wrapper glass-panel">
          <h2>Todavía no hay cambios</h2>
          <p style={{ margin: 0 }}>Cuando ejecutes una acción, cada cambio queda registrado acá.</p>
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
                return (
                  <tr key={key} style={{ opacity: c.undoneAt ? 0.55 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                      {new Date(c.at).toLocaleString()}
                    </td>
                    <td>{MODULES[c.module]?.label || c.module}</td>
                    <td>{c.action}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                      {c.previousValue === null || c.previousValue === undefined
                        ? '—'
                        : String(c.previousValue)}
                    </td>
                    <td>
                      {c.undoneAt ? (
                        <span style={{ color: 'var(--color-ink-3)' }}>Deshecho</span>
                      ) : c.reversible ? (
                        <button
                          className="btn btn-sm"
                          onClick={() => undo(c)}
                          disabled={undoing === key}
                        >
                          {undoing === key ? 'Deshaciendo…' : 'Deshacer'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--color-ink-3)' }} title="No se guardó un valor anterior">
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
      )}
    </>
  );
}
