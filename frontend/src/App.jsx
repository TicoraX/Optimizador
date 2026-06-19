import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ReportViewer from './components/ReportViewer';
import Scheduler from './components/Scheduler';

const API_BASE = 'http://127.0.0.1:3001/api';

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
    fetchStatus();
    
    // Set up polling interval every 30 seconds
    const interval = setInterval(fetchStatus, 30000);

    // Expose immediate refresh callback to the global window
    window.onDoneRefreshStatus = () => {
      fetchStatus();
    };

    return () => {
      clearInterval(interval);
      delete window.onDoneRefreshStatus;
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app-container">
        {/* Navigation Glass Bar */}
        <nav className="navbar">
          <div className="nav-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            <span>D1 Automations</span>
          </div>
          
          <div className="nav-links">
            <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
              Dashboard
            </NavLink>
            <NavLink to="/scheduler" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Programador
            </NavLink>
          </div>

          <div className="status-badge">
            <span className={`status-dot ${isOnline ? 'online' : 'offline'}`}></span>
            <span>{isOnline ? 'CONECTADO' : 'SIN CONEXIÓN'}</span>
          </div>
        </nav>

        {/* Central Router Container */}
        <main className="main-content">
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
            <Route path="/scheduler" element={<Scheduler />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
