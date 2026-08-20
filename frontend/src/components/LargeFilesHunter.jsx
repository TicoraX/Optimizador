import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '../config';

const THRESHOLD_OPTIONS = [
  { label: '> 100 MB', value: 100 },
  { label: '> 250 MB', value: 250 },
  { label: '> 500 MB', value: 500 },
  { label: '> 1 GB', value: 1024 },
  { label: '> 5 GB', value: 5120 },
];

export default function LargeFilesHunter() {
  const [minSizeMB, setMinSizeMB] = useState(250);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [revealingPath, setRevealingPath] = useState(null);

  const fetchFiles = useCallback(async (threshold) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/large-files?minSizeMB=${threshold}`);
      if (!res.ok) throw new Error('No se pudieron buscar los archivos grandes');
      const resData = await res.json();
      setData(resData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles(minSizeMB);
  }, [fetchFiles, minSizeMB]);

  const handleReveal = async (filePath) => {
    setRevealingPath(filePath);
    try {
      const res = await fetch(`${API_BASE}/large-files/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo abrir el Explorador de Windows para este archivo');
      }
    } catch (err) {
      console.error('Error abriendo explorador:', err);
      setError(err.message);
    } finally {
      setRevealingPath(null);
    }
  };

  const categories = useMemo(() => {
    if (!data?.files) return [];
    const set = new Set(data.files.map((f) => f.category));
    return Array.from(set);
  }, [data]);

  const filteredFiles = useMemo(() => {
    if (!data?.files) return [];
    return data.files.filter((f) => {
      const matchesCategory = filterCategory === 'all' || f.category === filterCategory;
      const matchesSearch = !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.path.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [data, filterCategory, searchQuery]);

  const filteredTotalBytes = useMemo(() => {
    return filteredFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
  }, [filteredFiles]);

  const fmtBytes = (bytes) => {
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="large-files-hunter">
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>Cazador de Archivos Gigantes</h1>
            <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
              Localiza y audita archivos masivos (ISOs, videos, copias de seguridad) ocupando espacio en tus carpetas.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>Umbral de tamaño:</span>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              {THRESHOLD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`btn btn-sm ${minSizeMB === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setMinSizeMB(opt.value)}
                  disabled={loading}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Tarjeta de Métricas Globales */}
      <div
        className="glass-panel"
        style={{
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-5)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>Espacio total encontrado</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-accent)' }}>
              {data ? data.totalFormatted : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>Archivos detectados</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
              {data ? `${data.fileCount} archivos` : '—'}
            </div>
          </div>
          {filterCategory !== 'all' || searchQuery ? (
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>En vista filtrada</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>
                {filteredFiles.length} ({fmtBytes(filteredTotalBytes)})
              </div>
            </div>
          ) : null}
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Buscar por nombre..."
            aria-label="Buscar archivos por nombre"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              backgroundColor: 'var(--color-surface-panel)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-ink-1)',
              width: 180,
            }}
          />

          <select
            className="input-field"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              backgroundColor: 'var(--color-surface-panel)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-ink-1)',
            }}
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fetchFiles(minSizeMB)}
            disabled={loading}
          >
            {loading ? 'Escaneando…' : 'Reescanear'}
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)', color: 'var(--color-danger)' }}>
          {error}
        </div>
      )}

      {/* Lista de Archivos */}
      {loading ? (
        <div className="glass-panel" style={{ padding: 'var(--space-6)' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 48, marginBottom: 'var(--space-3)' }} />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="empty-wrapper glass-panel">
          <h2>No se encontraron archivos mayores a {minSizeMB} MB</h2>
          <p style={{ margin: 0 }}>
            Tus carpetas principales están libres de archivos masivos en este umbral.
          </p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflowX: 'auto' }}>
          <table className="scheduler-table">
            <thead>
              <tr>
                <th scope="col">Tamaño</th>
                <th scope="col">Categoría</th>
                <th scope="col">Archivo y Ruta</th>
                <th scope="col">Modificado</th>
                <th scope="col" style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((f) => (
                <tr key={f.path}>
                  <td>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        fontSize: 'var(--text-sm)',
                        color: f.sizeMB >= 1024 ? 'var(--color-danger)' : 'var(--color-ink-1)',
                      }}
                    >
                      {f.sizeFormatted}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                      {f.category}
                    </span>
                  </td>
                  <td style={{ maxWidth: 420 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', wordBreak: 'break-all' }}>
                      {f.name}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-ink-3)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 400,
                      }}
                      title={f.path}
                    >
                      {f.path}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                    {f.mtime}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleReveal(f.path)}
                      disabled={revealingPath === f.path}
                      title="Mostrar este archivo seleccionado en el Explorador de Windows"
                    >
                      {revealingPath === f.path ? 'Abriendo…' : 'Abrir carpeta'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
