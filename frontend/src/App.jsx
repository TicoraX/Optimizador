import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ReportViewer from './components/ReportViewer';
import Scheduler from './components/Scheduler';
import History from './components/History';
import ErrorBoundary from './components/ErrorBoundary';
import { MODULES, MODULE_KEYS } from './modules';
import { ModuleIcon } from './components/ModuleIcon';
import { API_BASE } from './config';

export default function App() {
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOnline, setIsOnline] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error('Servidor remoto inalcanzable');
      const data = await res.json();
      setSystemStatus(data);
      setError(null);
      setIsOnline(true);
    } catch (err) {
      setError(err.message);
      setIsOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // `alive` evita setear estado si el componente se desmonta antes de que
    // responda el primer fetch.
    let alive = true;
    const tick = async () => { if (alive) await fetchStatus(); };

    tick();
    const interval = setInterval(tick, 30000);

    // Canal para que ReportViewer pida un refresco al terminar una accion.
    window.onDoneRefreshStatus = tick;

    return () => {
      alive = false;
      clearInterval(interval);
      delete window.onDoneRefreshStatus;
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app-container">
        {/* Navigation Glass Bar */}
        <nav className="navbar" aria-label="Principal">
          <div className="nav-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            <span>Optimizador</span>
          </div>

          {/* Rail con los 9 modulos. Antes eran dos links y llegar a un modulo
              exigia pasar por el dashboard. */}
          <div className="nav-links">
            <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
              <ModuleIcon path="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" size={16} />
              Dashboard
            </NavLink>
            {MODULE_KEYS.map((key) => (
              <NavLink
                key={key}
                to={`/report/${key}`}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <ModuleIcon path={MODULES[key].icon} size={16} />
                {MODULES[key].label}
              </NavLink>
            ))}
            <NavLink to="/historial" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <ModuleIcon path="M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2" size={16} />
              Historial
            </NavLink>
            <NavLink to="/scheduler" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <ModuleIcon path="M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" size={16} />
              Programador
            </NavLink>
          </div>

          {/* role=status para que un lector de pantalla anuncie el cambio de
              conexion, que antes solo se comunicaba por color. */}
          <div className="status-badge" role="status">
            <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <span>{isOnline ? 'Conectado' : 'Sin conexión'}</span>
          </div>
        </nav>

        {/* Central Router Container */}
        <main className="main-content">
          <ErrorBoundary>
            <Routes>
              <Route 
                path="/" 
                element={
                  <Dashboard 
                    systemStatus={systemStatus} 
                    loading={loading} 
                    error={error} 
                    onRefreshStatus={fetchStatus} 
                  />
                } 
              />
              <Route path="/report/:module" element={<ReportViewer />} />
              <Route path="/historial" element={<History />} />
              <Route path="/scheduler" element={<Scheduler />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
