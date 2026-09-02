import { useState, useEffect } from 'react';
import { API_BASE } from '../config';
import { ModuleIcon } from './ModuleIcon';

export default function ProfilesSelector({ onProfileApplied }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState(null);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadProfiles() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/profiles`);
        if (!res.ok) throw new Error('Error al cargar perfiles de optimización');
        const json = await res.json();
        setProfiles(json.profiles || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadProfiles();
  }, []);

  const handleApply = async (profileId) => {
    try {
      setApplyingId(profileId);
      setResult(null);
      setError(null);

      const res = await fetch(`${API_BASE}/profiles/${profileId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Error ${res.status} al aplicar perfil`);
      }

      const json = await res.json();
      setResult(json);
      if (onProfileApplied) onProfileApplied(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplyingId(null);
    }
  };

  if (loading) {
    return (
      <div className="card profiles-card mb-6 p-4">
        <div className="flex items-center gap-2 text-muted">
          <span className="spinner-border spinner-border-sm" role="status" />
          <span>Cargando perfiles de optimización...</span>
        </div>
      </div>
    );
  }

  if (error && profiles.length === 0) {
    return (
      <div className="card profiles-card mb-6 p-4 border border-danger/30 text-xs text-danger">
        No se pudieron cargar los perfiles: {error}
      </div>
    );
  }

  if (profiles.length === 0) return null;

  return (
    <div className="card profiles-card mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white mb-1">
            Perfiles de Optimización en 1 Clic
          </h2>
          <p className="text-xs text-muted">
            Aplica ajustes integrales calibrados para flujos de trabajo específicos sin alterar manualmente cada módulo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-primary"
            />
            <span>Simular cambios (dryRun)</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {profiles.map((p) => {
          const isApplying = applyingId === p.id;
          return (
            <div
              key={p.id}
              className="profile-preset-card p-4 rounded border flex flex-col justify-between"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="profile-icon-wrapper p-2 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <ModuleIcon moduleKey={p.icon || 'gaming'} className="w-5 h-5 text-primary" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white leading-tight">{p.name}</h3>
                    <span className="text-[11px] text-muted">{p.stepCount} módulos encadenados</span>
                  </div>
                </div>
                <p className="text-xs text-muted mb-4 line-clamp-3">
                  {p.desc}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleApply(p.id)}
                disabled={applyingId !== null}
                className="btn btn-sm btn-outline-primary w-full text-xs font-medium py-1.5"
              >
                {isApplying ? 'Aplicando...' : dryRun ? 'Simular Perfil' : 'Activar Perfil'}
              </button>
            </div>
          );
        })}
      </div>

      {result && (
        <div className="mt-4 p-3 rounded bg-surface-dark border border-border text-xs">
          <div className="font-semibold text-success mb-1">
            {result.dryRun ? 'Simulación de perfil completada exitosamente' : 'Perfil aplicado exitosamente'}
          </div>
          <div className="text-muted">
            Pasos procesados: {result.results?.length || 0} módulos ({result.results?.filter((r) => r.ok).length} correctos).
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded bg-danger/10 border border-danger/30 text-xs text-danger">
          Error: {error}
        </div>
      )}
    </div>
  );
}
