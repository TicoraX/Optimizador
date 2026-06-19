import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://127.0.0.1:3001/api';

function classifyLine(line) {
  if (line.includes('===')) return 'sep';
  if (line.match(/ERROR|FALLO|fallo|error/i)) return 'err';
  if (line.match(/completado|OK|exitosamente|Deshabilitado|borrados|vaciada/i)) return 'ok';
  return '';
}

export default function LogViewer({ module }) {
  const [lines, setLines]       = useState([]);
  const [size, setSize]         = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [clearing, setClearing] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/logs/${module}`);
      if (res.status === 404) { setLines([]); setSize(0); return; }
      if (!res.ok) throw new Error('No se pudo leer el log');
      const data = await res.json();
      setLines(data.lines || []);
      setSize(data.size || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleClear = async (rotate = false) => {
    if (!confirm(rotate ? '¿Rotar y vaciar el log? Se guardará una copia .bak' : '¿Vaciar el log de acciones?')) return;
    setClearing(true);
    try {
      const res = await fetch(`${API_BASE}/logs/${module}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate }),
      });
      if (!res.ok) throw new Error('No se pudo limpiar el log');
      await fetchLogs();
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="log-viewer-panel glass-panel">
      <div className="log-viewer-header">
        <span className="log-viewer-title">
          ACTION LOG — {module.toUpperCase()}
          {size > 0 && <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: '1rem', fontWeight: 400 }}>{(size / 1024).toFixed(1)} KB</span>}
        </span>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}
            onClick={fetchLogs}
            disabled={loading || clearing}
          >
            Actualizar
          </button>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}
            onClick={() => handleClear(true)}
            disabled={clearing || lines.length === 0}
          >
            Rotar
          </button>
          <button
            className="btn btn-danger"
            style={{ width: 'auto', padding: '0.3rem 0.8rem', fontSize: '0.78rem' }}
            onClick={() => handleClear(false)}
            disabled={clearing || lines.length === 0}
          >
            Vaciar
          </button>
        </div>
      </div>

      <div className="log-viewer-body">
        {loading ? (
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>Cargando...</span>
        ) : error ? (
          <span className="log-line-err">[ERROR] {error}</span>
        ) : lines.length === 0 ? (
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>Sin entradas en el log.</span>
        ) : (
          lines.map((line, i) => {
            const cls = classifyLine(line);
            // Highlight timestamps like [2026-06-18 16:53:32]
            const parts = line.match(/^(\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\])\s?(.*)$/s);
            return (
              <div key={i} className={`terminal-line${cls ? ' log-line-' + cls : ''}`}>
                {parts ? (
                  <>
                    <span className="log-line-timestamp">{parts[1]}</span>
                    {parts[2]}
                  </>
                ) : line}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
