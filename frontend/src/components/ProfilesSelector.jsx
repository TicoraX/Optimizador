import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../config';
import { ModuleIcon } from './ModuleIcon';

export default function ProfilesSelector({ onProfileApplied }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState(null);
  const [applyProgress, setApplyProgress] = useState(null);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const abortCtrlRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function loadProfiles() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/profiles`);
        if (!res.ok) throw new Error('Error al cargar perfiles de optimización');
        const json = await res.json();
        if (active) setProfiles(json.profiles || []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadProfiles();
    return () => { active = false; };
  }, []);

  const handleCancel = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    setApplyingId(null);
    setApplyProgress(null);
    setError('Aplicación de perfil cancelada por el usuario');
  }, []);

  const handleApply = async (profileId) => {
    if (applyingId) return;

    try {
      setApplyingId(profileId);
      setResult(null);
      setError(null);
      setApplyProgress({ current: 0, total: 4, module: 'Iniciando...', percentage: 0, log: '' });

      const ctrl = new AbortController();
      abortCtrlRef.current = ctrl;

      const timeoutId = setTimeout(() => {
        ctrl.abort();
      }, 45000);

      const res = await fetch(`${API_BASE}/profiles/${profileId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
        },
        body: JSON.stringify({ dryRun }),
        signal: ctrl.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Error HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No se pudo inicializar la lectura del stream');
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData = [];

        const dispatchEvent = (ev, dataStr) => {
          if (ev === 'progress') {
            try {
              const p = JSON.parse(dataStr);
              setApplyProgress(prev => ({
                ...prev,
                current: p.current,
                total: p.total,
                module: p.module,
                percentage: p.percentage,
              }));
            } catch { /* parse error ignore */ }
          } else if (ev === 'output') {
            setApplyProgress(prev => ({
              ...prev,
              log: dataStr.replace(/^\[PERFIL\]\s*/, ''),
            }));
          } else if (ev === 'error') {
            setError(dataStr);
          } else if (ev === 'done') {
            try {
              const d = JSON.parse(dataStr);
              if (d.exitCode === 0) {
                setResult({ ok: true, dryRun, profileId });
              } else {
                setError('El proceso finalizó con advertencias.');
              }
            } catch {
              setResult({ ok: true, dryRun, profileId });
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              if (currentData.length > 0) {
                dispatchEvent(currentEvent, currentData.join('\n'));
                currentData = [];
                currentEvent = 'message';
              }
              continue;
            }
            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7).trim();
            } else if (trimmed.startsWith('data: ')) {
              currentData.push(trimmed.slice(6));
            }
          }
        }
        if (currentData.length > 0) {
          dispatchEvent(currentEvent, currentData.join('\n'));
        }
      } else {
        const json = await res.json();
        setResult(json);
      }

      if (onProfileApplied) onProfileApplied();
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('La operación tardó demasiado o fue cancelada.');
      } else {
        setError(err.message);
      }
    } finally {
      setApplyingId(null);
      setApplyProgress(null);
      abortCtrlRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid currentColor',
              borderRightColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>Cargando perfiles de optimización...</span>
        </div>
      </div>
    );
  }

  if (error && profiles.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderLeft: '4px solid var(--color-danger)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }}>
          No se pudieron cargar los perfiles: {error}
        </div>
      </div>
    );
  }

  if (profiles.length === 0) return null;

  return (
    <div
      className="glass-panel"
      style={{
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-1)' }}>
            Perfiles de Optimización en 1 Clic
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
            Aplica ajustes integrales calibrados para flujos de trabajo específicos sin alterar manualmente cada módulo.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span>Simular cambios (dryRun)</span>
          </label>
        </div>
      </div>

      {applyingId && applyProgress && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-paper-3)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-rule)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, flex: 1 }}>
            <span
              style={{
                width: 14,
                height: 14,
                border: '2px solid var(--color-accent)',
                borderRightColor: 'transparent',
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-ink)' }}>
                Aplicando {profiles.find((p) => p.id === applyingId)?.name || 'perfil'}
                {applyProgress.total > 0 ? ` — Paso ${applyProgress.current} de ${applyProgress.total}` : ''}
              </div>
              {applyProgress.log && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {applyProgress.log}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={handleCancel}
            style={{ fontSize: 'var(--text-xs)' }}
          >
            Cancelar
          </button>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {profiles.map((p) => {
          const isApplying = applyingId === p.id;
          return (
            <div
              key={p.id}
              className="glass-panel"
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: isApplying ? '1px solid var(--color-accent)' : '1px solid var(--color-rule)',
                borderRadius: 'var(--radius)',
                background: isApplying ? 'var(--color-paper-3)' : 'var(--color-paper-2)',
                transition: 'border-color var(--dur) var(--ease-out)',
              }}
            >
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <span
                    style={{
                      background: 'var(--color-paper-3)',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'inline-flex',
                      color: 'var(--color-accent)',
                    }}
                  >
                    <ModuleIcon moduleKey={p.icon || 'gaming'} style={{ width: 18, height: 18 }} />
                  </span>
                  <div>
                    <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)', margin: 0, lineHeight: 1.2 }}>
                      {p.name}
                    </h3>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)' }}>
                      {p.stepCount} módulos encadenados
                    </span>
                  </div>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', margin: 0, lineHeight: 1.4 }}>
                  {p.desc}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleApply(p.id)}
                disabled={applyingId !== null}
                className={`btn ${dryRun ? 'btn-secondary' : 'btn-primary'}`}
                style={{ width: '100%', fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}
              >
                {isApplying
                  ? `Aplicando (${applyProgress?.current || 1}/${p.stepCount})...`
                  : dryRun
                    ? 'Simular Perfil'
                    : 'Activar Perfil'}
              </button>
            </div>
          );
        })}
      </div>

      {result && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius)',
            background: 'var(--color-paper-3)',
            border: '1px solid var(--color-rule)',
            fontSize: 'var(--text-xs)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-success)', marginBottom: 'var(--space-1)' }}>
            {result.dryRun ? 'Simulación de perfil completada exitosamente' : 'Perfil aplicado exitosamente'}
          </div>
          <div style={{ color: 'var(--color-ink-3)' }}>
            Ajustes aplicados al sistema en modo {result.dryRun ? 'simulación' : 'activo'}.
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius)',
            background: 'oklch(from var(--color-danger) l c h / 0.1)',
            border: '1px solid var(--color-danger)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-danger)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
