import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { API_BASE } from '../config';

export default function Dashboard({ systemStatus, loading, error, onRefreshStatus }) {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState({});

  const handleScan = async (module) => {
    if (scanning[module]) return;
    setScanning(prev => ({ ...prev, [module]: true }));

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 330000);

    try {
      const res = await fetch(`${API_BASE}/scan/${module}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: ctrl.signal,
      });
      
      if (!res.ok) throw new Error('Error al iniciar el escaneo');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          if (chunk.includes('event: done')) {
            break;
          }
        }
      }

      onRefreshStatus();
    } catch (err) {
      if (err.name !== 'AbortError') {
        alert(`Error de escaneo: ${err.message}`);
      }
    } finally {
      clearTimeout(timeout);
      setScanning(prev => ({ ...prev, [module]: false }));
    }
  };

  const formatSize = (mb) => {
    if (mb === undefined || mb === null) return '0 MB';
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const formatMs = (ms) => {
    if (!ms) return 'N/A';
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (loading) {
    return (
      <div className="dashboard-grid">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-panel module-card" style={{ height: '350px' }}>
            <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '12px', marginBottom: '1.5rem' }} />
            <div className="skeleton" style={{ width: '60%', height: '24px', marginBottom: '1rem' }} />
            <div className="skeleton" style={{ width: '100%', height: '18px', marginBottom: '0.8rem' }} />
            <div className="skeleton" style={{ width: '85%', height: '18px', marginBottom: '0.8rem' }} />
            <div className="skeleton" style={{ width: '90%', height: '18px', marginBottom: '0.8rem' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-wrapper glass-panel">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--warning)', marginBottom: '1rem'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <h3>Error de conexión con el backend</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Asegúrate de que el servidor local en `http://127.0.0.1:3001` esté en funcionamiento.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: '1.5rem', width: 'auto' }} onClick={onRefreshStatus}>
          Reintentar Conexión
        </button>
      </div>
    );
  }

  const { updates, cleanup, startup, ram } = systemStatus || {};

  // Parse boot history for Recharts
  const chartData = (startup?.bootHistory || [])
    .filter(d => d.boot_time_ms > 0)
    .map(d => ({
      fecha: d.date,
      tiempo: parseFloat((d.boot_time_ms / 1000).toFixed(2))
    }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="dashboard-grid">
        {/* Module 1: Update Checker */}
        <div className="glass-panel module-card">
          <div className="card-header">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="card-title">Actualizaciones</span>
              <span className="card-subtitle">Último escaneo: {updates?.lastScan || 'Nunca'}</span>
            </div>
            <div className="card-icon" style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 3h5v5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 21H3v-5"/></svg>
            </div>
          </div>
          
          <div className="card-body">
            <div className="metric-row">
              <span className="metric-label">Windows (Winget)</span>
              <span className={`metric-value ${updates?.winget?.count > 0 ? 'has-warning' : ''}`}>
                {updates?.winget?.count ?? 0} pendientes
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Python (Pip)</span>
              <span className={`metric-value ${updates?.pip?.count > 0 ? 'has-warning' : ''}`}>
                {updates?.pip?.count ?? 0} pendientes
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Node.js (NPM Global)</span>
              <span className={`metric-value ${updates?.npm?.count > 0 ? 'has-warning' : ''}`}>
                {updates?.npm?.count ?? 0} pendientes
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Chocolatey</span>
              <span className={`metric-value ${updates?.choco?.count > 0 ? 'has-warning' : ''}`}>
                {updates?.choco?.count ?? 0} pendientes
              </span>
            </div>
          </div>

          <div className="card-footer">
            <button className="btn btn-secondary" onClick={() => handleScan('updates')} disabled={scanning['updates']}>
              {scanning['updates'] ? 'Escaneando...' : 'Escanear'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/report/updates')}>
              Ver Reporte
            </button>
          </div>
        </div>

        {/* Module 2: Disk Cleanup */}
        <div className="glass-panel module-card">
          <div className="card-header">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="card-title">Limpieza de Disco</span>
              <span className="card-subtitle">Último escaneo: {cleanup?.lastScan || 'Nunca'}</span>
            </div>
            <div className="card-icon" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </div>
          </div>
          
          <div className="card-body">
            <div className="metric-row">
              <span className="metric-label">Archivos Temporales</span>
              <span className="metric-value">{formatSize(cleanup?.temp?.total_mb)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Caché de Navegadores</span>
              <span className="metric-value">{formatSize(cleanup?.browserCache?.total_mb)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Descargas Antiguas</span>
              <span className="metric-value">{formatSize(cleanup?.downloads?.total_mb)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Papelera de Reciclaje</span>
              <span className="metric-value">{formatSize(cleanup?.recycleBin?.total_mb)}</span>
            </div>
          </div>

          <div className="card-footer">
            <button className="btn btn-secondary" onClick={() => handleScan('cleanup')} disabled={scanning['cleanup']}>
              {scanning['cleanup'] ? 'Escaneando...' : 'Escanear'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/report/cleanup')}>
              Ver Reporte
            </button>
          </div>
        </div>

        {/* Module 3: Startup Optimizer */}
        <div className="glass-panel module-card">
          <div className="card-header">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="card-title">Optimización de Inicio</span>
              <span className="card-subtitle">Último escaneo: {startup?.lastScan || 'Nunca'}</span>
            </div>
            <div className="card-icon" style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
          </div>
          
          <div className="card-body">
            <div className="metric-row">
              <span className="metric-label">Programas de Inicio</span>
              <span className="metric-value">{startup?.startupPrograms?.count ?? 0}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Servicios Auto-start (No-MS)</span>
              <span className="metric-value">{startup?.autoServices?.count ?? 0}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Tareas Logon Activas</span>
              <span className="metric-value">
                {startup?.logonTasks?.enabled ?? 0} / {startup?.logonTasks?.count ?? 0}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Último Arranque</span>
              <span className="metric-value">
                {startup?.bootPerformance?.boot_time_ms ? formatMs(startup.bootPerformance.boot_time_ms) : 'N/A'}
              </span>
            </div>
          </div>

          <div className="card-footer">
            <button className="btn btn-secondary" onClick={() => handleScan('startup')} disabled={scanning['startup']}>
              {scanning['startup'] ? 'Escaneando...' : 'Escanear'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/report/startup')}>
              Ver Reporte
            </button>
          </div>
        </div>

        {/* Module 4: RAM Optimizer */}
        <div className="glass-panel module-card">
          <div className="card-header">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="card-title">Optimización de RAM</span>
              <span className="card-subtitle">Último escaneo: {ram?.lastScan || 'Nunca'}</span>
            </div>
            <div className="card-icon" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
            </div>
          </div>

          <div className="card-body">
            {(ram?.usagePercent ?? 0) >= 90 && (
              <div style={{
                background: 'rgba(255, 50, 50, 0.15)', border: '1px solid rgba(255, 50, 50, 0.3)',
                borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
                fontSize: '0.8rem', color: 'var(--danger)',
              }}>
                ⚠ Uso de RAM crítico ({ram?.usagePercent}%). Considera liberar memoria.
              </div>
            )}
            <div className="metric-row">
              <span className="metric-label">RAM Total</span>
              <span className="metric-value">{formatSize(ram?.totalMB)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">RAM en Uso</span>
              <span className={`metric-value ${(ram?.usagePercent ?? 0) > 80 ? 'has-warning' : ''}`}>
                {formatSize(ram?.usedMB)} ({ram?.usagePercent ?? 0}%)
              </span>
            </div>
            <div className="metric-row" style={{ borderBottom: 'none' }}>
              <span className="metric-label">RAM Libre</span>
              <span className="metric-value">{formatSize(ram?.freeMB)}</span>
            </div>
            <div className="metric-row" style={{ borderBottom: 'none' }}>
              <span className="metric-label">Procesos Candidatos</span>
              <span className="metric-value">{ram?.knownProcesses ?? 0}</span>
            </div>
            <div style={{ marginTop: '0.75rem', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(ram?.usagePercent ?? 0, 100)}%`,
                background: (ram?.usagePercent ?? 0) > 80 ? 'var(--danger)' : (ram?.usagePercent ?? 0) > 60 ? 'var(--warning)' : 'var(--success)',
                borderRadius: '3px',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>

          <div className="card-footer">
            <button className="btn btn-secondary" onClick={() => handleScan('ram')} disabled={scanning['ram']}>
              {scanning['ram'] ? 'Escaneando...' : 'Escanear'}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/report/ram')}>
              Ver Reporte
            </button>
          </div>
        </div>

        {/* RAM Process Breakdown */}
        {(ram?.lastScan) && (
          <div className="glass-panel module-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/report/ram')}>
            <div className="card-header">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="card-title">Desglose de Procesos</span>
                <span className="card-subtitle">Categorías del último escaneo</span>
              </div>
              <div className="card-icon" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
            </div>
            <div className="card-body">
              <div className="metric-row" onClick={(e) => { e.stopPropagation(); navigate('/report/ram'); }}>
                <span className="metric-label" style={{ color: 'var(--success)' }}>Identificados (seguros)</span>
                <span className="metric-value" style={{ color: 'var(--success)' }}>{ram?.knownProcesses ?? 0}</span>
              </div>
              <div className="metric-row" onClick={(e) => { e.stopPropagation(); navigate('/report/ram'); }}>
                <span className="metric-label" style={{ color: 'var(--warning)' }}>No recomendados</span>
                <span className="metric-value" style={{ color: 'var(--warning)' }}>{ram?.riskyProcesses ?? 0}</span>
              </div>
              <div className="metric-row" onClick={(e) => { e.stopPropagation(); navigate('/report/ram'); }}>
                <span className="metric-label" style={{ color: '#a0a0b8' }}>No identificados</span>
                <span className="metric-value" style={{ color: '#a0a0b8' }}>{ram?.unknownProcesses ?? 0}</span>
              </div>
              <div className="metric-row" style={{ borderBottom: 'none' }} onClick={(e) => { e.stopPropagation(); navigate('/report/ram'); }}>
                <span className="metric-label" style={{ color: 'var(--danger)' }}>Críticos (sistema)</span>
                <span className="metric-value" style={{ color: 'var(--danger)' }}>{ram?.criticalProcesses ?? 0}</span>
              </div>
            </div>
            <div className="card-footer" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {ram?.totalProcesses ?? 0} procesos totales — clic para ver detalle
            </div>
          </div>
        )}
      </div>

      {/* Boot Performance Chart */}
      {chartData.length > 0 && (
        <div className="glass-panel chart-card">
          <h3 className="panel-title" style={{ marginBottom: '1rem' }}>Historial de Tiempos de Arranque (Segundos)</h3>
          <div style={{ width: '100%', height: 'calc(100% - 40px)' }}>
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="fecha" stroke="var(--text-muted)" style={{ fontSize: '0.8rem' }} />
                <YAxis stroke="var(--text-muted)" style={{ fontSize: '0.8rem' }} unit="s" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0d0f17', 
                    borderColor: 'var(--border-color)', 
                    borderRadius: '8px', 
                    color: 'var(--text-main)' 
                  }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="tiempo" 
                  name="Tiempo de Arranque"
                  stroke="var(--primary)" 
                  strokeWidth={3} 
                  activeDot={{ r: 8 }} 
                  dot={{ strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
