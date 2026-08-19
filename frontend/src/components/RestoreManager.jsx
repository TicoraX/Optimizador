import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

export default function RestoreManager() {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('Optimizador D1 - Punto de Seguridad');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const fetchPoints = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/restore/points`);
      if (!res.ok) throw new Error('No se pudo consultar los puntos de restauración');
      const data = await res.json();
      setPoints(data.points || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;

    setCreating(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/restore/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!res.ok) {
        throw new Error('No se pudo crear el punto de restauración');
      }
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'No se pudo crear el punto de restauración');
      }

      setMessage(`Punto de restauración creado con éxito: "${data.description}"`);
      await fetchPoints();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="restore-manager">
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>Puntos de Restauración de Windows</h1>
            <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
              Crea salvaguardas a nivel de sistema operativo antes de realizar cambios profundos en servicios o registro.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchPoints}
            disabled={loading || creating}
          >
            {loading ? 'Consultando…' : 'Refrescar'}
          </button>
        </div>
      </header>

      {/* Panel de Creación de Punto de Restauración */}
      <div
        className="glass-panel"
        style={{
          padding: 'var(--space-5)',
          marginBottom: 'var(--space-6)',
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-base)', margin: '0 0 var(--space-3) 0', fontWeight: 600 }}>
          Crear Nuevo Punto de Restauración
        </h2>

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (ej. Optimizador D1 Pre-Clean)"
            disabled={creating}
            style={{
              flex: '1 1 300px',
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--color-surface-panel)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-ink-1)',
            }}
          />

          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !description.trim()}
            style={{ minWidth: 160 }}
          >
            {creating ? 'Creando punto…' : 'Crear Punto de Seguridad'}
          </button>
        </form>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', marginTop: 'var(--space-2)' }}>
          Nota: Requiere que el servidor esté ejecutándose con privilegios de Administrador en Windows.
        </div>

        {message && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid var(--color-success)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-success)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Lista de Puntos de Restauración Existentes */}
      <section aria-labelledby="points-list-title">
        <h2 id="points-list-title" style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)', fontWeight: 600 }}>
          Puntos Existentes ({points.length})
        </h2>

        {loading ? (
          <div className="glass-panel" style={{ padding: 'var(--space-6)' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 44, marginBottom: 'var(--space-3)' }} />
            ))}
          </div>
        ) : points.length === 0 ? (
          <div className="empty-wrapper glass-panel">
            <h2>No se encontraron puntos de restauración</h2>
            <p style={{ margin: 0 }}>
              Puedes crear el primer punto de restauración con el botón superior para proteger tu sistema.
            </p>
          </div>
        ) : (
          <div className="glass-panel" style={{ overflowX: 'auto' }}>
            <table className="scheduler-table">
              <thead>
                <tr>
                  <th scope="col"># Secuencia</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Fecha de Creación</th>
                  <th scope="col">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.sequenceNumber || p.description}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      #{p.sequenceNumber}
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      {p.description}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                      {p.creationTime}
                    </td>
                    <td>
                      <span
                        className="badge badge-neutral"
                        style={{ fontSize: '11px', textTransform: 'capitalize' }}
                      >
                        {typeof p.type === 'string' ? p.type.toLowerCase().replace(/_/g, ' ') : (p.type ?? '—')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
