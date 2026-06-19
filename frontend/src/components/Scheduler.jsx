import React, { useState, useEffect } from 'react';

const API_BASE = 'http://127.0.0.1:3001/api';
const WEEKDAYS = [
  { value: 'MON', label: 'Lun' },
  { value: 'TUE', label: 'Mar' },
  { value: 'WED', label: 'Mié' },
  { value: 'THU', label: 'Jue' },
  { value: 'FRI', label: 'Vie' },
  { value: 'SAT', label: 'Sáb' },
  { value: 'SUN', label: 'Dom' },
];

export default function Scheduler() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState({});
  const [editingTask, setEditingTask] = useState(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const [frequency, setFrequency] = useState('weekly');
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState(['MON']);
  const [intervalDays, setIntervalDays] = useState(1);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/scheduler`);
      if (!res.ok) throw new Error('Error al cargar tareas programadas');
      const data = await res.json();
      setTasks(data.tasks || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleToggle = async (taskName, currentStatus) => {
    const isCurrentlyEnabled = currentStatus.toLowerCase() === 'ready' || currentStatus.toLowerCase() === 'running';
    const newEnableState = !isCurrentlyEnabled;

    setToggling(prev => ({ ...prev, [taskName]: true }));
    try {
      const res = await fetch(`${API_BASE}/scheduler/${taskName}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: newEnableState }),
      });

      if (!res.ok) throw new Error('No se pudo cambiar el estado de la tarea');

      setTasks(prev =>
        prev.map(t =>
          t.name === taskName ? { ...t, status: newEnableState ? 'Ready' : 'Disabled' } : t
        )
      );
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setToggling(prev => ({ ...prev, [taskName]: false }));
    }
  };

  const openSchedule = (taskName) => {
    setEditingTask(taskName);
    setScheduleError(null);
    setFrequency('weekly');
    setTime('09:00');
    setDays(['MON']);
    setIntervalDays(1);
  };

  const closeSchedule = () => {
    setEditingTask(null);
    setScheduleError(null);
  };

  const toggleDay = (value) => {
    setDays(prev => prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value]);
  };

  const saveSchedule = async () => {
    if (frequency === 'weekly' && days.length === 0) {
      setScheduleError('Selecciona al menos un día.');
      return;
    }
    setSavingSchedule(true);
    setScheduleError(null);
    try {
      const body = { frequency, time };
      if (frequency === 'weekly') body.days = days;
      else body.intervalDays = intervalDays;

      const res = await fetch(`${API_BASE}/scheduler/${editingTask}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo reprogramar la tarea');

      setEditingTask(null);
      fetchTasks();
    } catch (err) {
      setScheduleError(err.message);
    } finally {
      setSavingSchedule(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h2 className="panel-title">Tareas Programadas Semanales</h2>
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ width: '100%', height: '50px', marginBottom: '1rem' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-wrapper glass-panel">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--warning)', marginBottom: '1rem'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <h3>Error al consultar el Programador de Tareas</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>{error}</p>
        <button className="btn btn-secondary" style={{ marginTop: '1.5rem', width: 'auto' }} onClick={fetchTasks}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '2rem', overflowX: 'auto' }}>
      <h2 className="panel-title">Programador de Tareas de Windows</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Activa, desactiva o reprograma cuándo corre automáticamente cada automatización.
      </p>

      {tasks.length === 0 ? (
        <div className="empty-wrapper">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--text-muted)', marginBottom: '1rem'}}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <p>No se encontraron tareas registradas.</p>
        </div>
      ) : (
        <table className="scheduler-table">
          <thead>
            <tr>
              <th>Nombre de la Tarea</th>
              <th>Próxima Ejecución</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(task => {
              const isEnabled = task.status.toLowerCase() === 'ready' || task.status.toLowerCase() === 'running';
              const isEditing = editingTask === task.name;
              return (
                <React.Fragment key={task.name}>
                  <tr>
                    <td style={{ fontWeight: '500' }}>
                      {task.name.replace('_Weekly', '')}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '0.2rem' }}>
                        {task.name}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {task.nextRun || 'No programada'}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: isEnabled ? 'var(--success)' : 'var(--text-muted)',
                          background: isEnabled ? 'var(--success-glow)' : 'rgba(255, 255, 255, 0.02)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          border: `1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-color)'}`
                        }}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        onClick={() => isEditing ? closeSchedule() : openSchedule(task.name)}
                      >
                        {isEditing ? 'Cerrar' : 'Configurar horario'}
                      </button>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          disabled={toggling[task.name]}
                          onChange={() => handleToggle(task.name, task.status)}
                        />
                        <span className="slider"></span>
                      </label>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr>
                      <td colSpan={4}>
                        <div className="schedule-editor">
                          <div className="schedule-editor-row">
                            <label className="form-label" style={{ marginBottom: 0 }}>Frecuencia:</label>
                            <div className="schedule-freq-toggle">
                              <button
                                className={`btn ${frequency === 'weekly' ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                                onClick={() => setFrequency('weekly')}
                              >
                                Semanal
                              </button>
                              <button
                                className={`btn ${frequency === 'daily' ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                                onClick={() => setFrequency('daily')}
                              >
                                Diaria / cada N días
                              </button>
                            </div>
                          </div>

                          <div className="schedule-editor-row">
                            <label className="form-label" style={{ marginBottom: 0 }}>Hora:</label>
                            <input
                              type="time"
                              value={time}
                              onChange={(e) => setTime(e.target.value)}
                              className="schedule-time-input"
                            />
                          </div>

                          {frequency === 'weekly' ? (
                            <div className="schedule-editor-row">
                              <label className="form-label" style={{ marginBottom: 0 }}>Días:</label>
                              <div className="schedule-days-picker">
                                {WEEKDAYS.map(d => (
                                  <button
                                    key={d.value}
                                    className={`schedule-day-btn ${days.includes(d.value) ? 'active' : ''}`}
                                    onClick={() => toggleDay(d.value)}
                                  >
                                    {d.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="schedule-editor-row">
                              <label className="form-label" style={{ marginBottom: 0 }}>Cada cuántos días:</label>
                              <input
                                type="number"
                                min="1"
                                max="365"
                                value={intervalDays}
                                onChange={(e) => setIntervalDays(parseInt(e.target.value, 10) || 1)}
                                className="schedule-interval-input"
                              />
                            </div>
                          )}

                          {scheduleError && (
                            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{scheduleError}</p>
                          )}

                          <div className="schedule-editor-row" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                            <button
                              className="btn btn-primary"
                              style={{ width: 'auto', padding: '0.5rem 1.2rem' }}
                              onClick={saveSchedule}
                              disabled={savingSchedule}
                            >
                              {savingSchedule ? 'Guardando...' : 'Guardar horario'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
