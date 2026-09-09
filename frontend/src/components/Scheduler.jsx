import { useState, useEffect, useCallback, Fragment } from 'react';
import { API_BASE } from '../config';

const WEEKDAYS = [
  { value: 'MON', label: 'Lun' },
  { value: 'TUE', label: 'Mar' },
  { value: 'WED', label: 'Mié' },
  { value: 'THU', label: 'Jue' },
  { value: 'FRI', label: 'Vie' },
  { value: 'SAT', label: 'Sáb' },
  { value: 'SUN', label: 'Dom' },
];

const AVAILABLE_PROFILES = [
  {
    id: 'dev',
    name: 'Mantenimiento & Limpieza Dev',
    desc: 'Purga cachés de compiladores y temporales, renueva DNS y libera memoria en reposo.',
    defaultTime: '03:00',
    defaultDays: ['SUN'],
    color: 'var(--color-primary)',
  },
  {
    id: 'gaming',
    name: 'Perfil Gaming & Latencia',
    desc: 'Temporizadores de precisión, HAGS, GameDVR y supresión de WerFault para evitar caídas de FPS.',
    defaultTime: '18:00',
    defaultDays: ['FRI', 'SAT'],
    color: 'var(--color-accent, #3b82f6)',
  },
  {
    id: 'work',
    name: 'Productividad & Oficina',
    desc: 'Privacidad de red, telemetría reducida y optimización de indexación local.',
    defaultTime: '08:30',
    defaultDays: ['MON'],
    color: 'var(--color-success)',
  },
  {
    id: 'battery',
    name: 'Laptop & Ahorro de Batería',
    desc: 'Minimiza la actividad en segundo plano y desactiva precargas para prolongar la autonomía.',
    defaultTime: '09:00',
    defaultDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    color: 'var(--color-warning)',
  },
];

export default function Scheduler() {
  const [activeTab, setActiveTab] = useState('profiles'); // 'profiles' | 'modules' | 'history'
  const [tasks, setTasks] = useState([]);
  const [scheduledProfiles, setScheduledProfiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState({});
  const [editingItem, setEditingItem] = useState(null); // { type: 'profile' | 'module', id: string, name: string }
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const [frequency, setFrequency] = useState('weekly');
  const [time, setTime] = useState('03:00');
  const [days, setDays] = useState(['SUN']);
  const [intervalDays, setIntervalDays] = useState(1);

  const fetchData = useCallback(async (signal) => {
    try {
      const [resMod, resProf, resHist] = await Promise.allSettled([
        fetch(`${API_BASE}/scheduler`, { signal }).then((r) => r.ok ? r.json() : { tasks: [] }),
        fetch(`${API_BASE}/scheduler/profiles`, { signal }).then((r) => r.ok ? r.json() : { profiles: [] }),
        fetch(`${API_BASE}/scheduler/history`, { signal }).then((r) => r.ok ? r.json() : { history: [] }),
      ]);

      if (resMod.status === 'fulfilled') setTasks(resMod.value.tasks || []);
      if (resProf.status === 'fulfilled') setScheduledProfiles(resProf.value.profiles || []);
      if (resHist.status === 'fulfilled') setHistory(resHist.value.history || []);
      setError(null);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => { ctrl.abort(); };
  }, [fetchData]);

  // Toggle de módulos individuales
  const handleToggleModule = async (taskName, currentStatus) => {
    const isCurrentlyEnabled = currentStatus.toLowerCase() === 'ready' || currentStatus.toLowerCase() === 'running';
    const newEnableState = !isCurrentlyEnabled;

    setToggling((prev) => ({ ...prev, [taskName]: true }));
    try {
      const res = await fetch(`${API_BASE}/scheduler/${taskName}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: newEnableState }),
      });

      if (!res.ok) throw new Error('No se pudo cambiar el estado de la tarea');

      setTasks((prev) =>
        prev.map((t) =>
          t.name === taskName ? { ...t, status: newEnableState ? 'Ready' : 'Disabled' } : t
        )
      );
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setToggling((prev) => ({ ...prev, [taskName]: false }));
    }
  };

  // Toggle de tareas de perfil
  const handleToggleProfile = async (taskName, currentStatus) => {
    const isCurrentlyEnabled = currentStatus.toLowerCase() === 'ready' || currentStatus.toLowerCase() === 'running';
    const newEnableState = !isCurrentlyEnabled;

    setToggling((prev) => ({ ...prev, [taskName]: true }));
    try {
      const res = await fetch(`${API_BASE}/scheduler/profiles/${taskName}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: newEnableState }),
      });

      if (!res.ok) throw new Error('No se pudo cambiar el estado del perfil');

      setScheduledProfiles((prev) =>
        prev.map((t) =>
          t.taskName === taskName ? { ...t, status: newEnableState ? 'Ready' : 'Disabled' } : t
        )
      );
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setToggling((prev) => ({ ...prev, [taskName]: false }));
    }
  };

  // Eliminar tarea de perfil
  const handleDeleteProfile = async (taskName) => {
    if (!confirm(`¿Eliminar la tarea programada '${taskName}' del sistema?`)) return;

    setToggling((prev) => ({ ...prev, [taskName]: true }));
    try {
      const res = await fetch(`${API_BASE}/scheduler/profiles/${taskName}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error al eliminar la tarea');
      setScheduledProfiles((prev) => prev.filter((t) => t.taskName !== taskName));
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setToggling((prev) => ({ ...prev, [taskName]: false }));
    }
  };

  // Abrir editor de horario
  const openScheduleEditor = (type, id, defaultTimeVal = '03:00', defaultDaysVal = ['SUN']) => {
    setEditingItem({ type, id });
    setScheduleError(null);
    setFrequency('weekly');
    setTime(defaultTimeVal);
    setDays(defaultDaysVal);
    setIntervalDays(1);
  };

  const closeScheduleEditor = () => {
    setEditingItem(null);
    setScheduleError(null);
  };

  const toggleDay = (value) => {
    setDays((prev) => prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]);
  };

  // Guardar horario (perfil o módulo)
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

      if (editingItem.type === 'profile') {
        body.profileId = editingItem.id;
        const res = await fetch(`${API_BASE}/scheduler/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al programar el perfil');
      } else {
        const res = await fetch(`${API_BASE}/scheduler/${editingItem.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al reprogramar la tarea');
      }

      setEditingItem(null);
      fetchData();
    } catch (err) {
      setScheduleError(err.message);
    } finally {
      setSavingSchedule(false);
    }
  };

  // Aplicar preajuste rápido con 1 clic
  const applyPreset = async (profileId, presetTime, presetDays) => {
    setSavingSchedule(true);
    try {
      const res = await fetch(`${API_BASE}/scheduler/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          frequency: 'weekly',
          time: presetTime,
          days: presetDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo activar el preajuste');
      fetchData();
    } catch (err) {
      alert(`Error al activar preajuste: ${err.message}`);
    } finally {
      setSavingSchedule(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h2 className="panel-title">Programador de Tareas y Automatización</h2>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ width: '100%', height: '50px', marginBottom: '1rem' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-wrapper glass-panel">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)', marginBottom: '1rem' }}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <h3>Error al consultar el Programador de Tareas</h3>
        <p style={{ color: 'var(--color-ink-3)', marginTop: '0.5rem' }}>{error}</p>
        <button className="btn btn-secondary" style={{ marginTop: '1.5rem', width: 'auto' }} onClick={() => fetchData()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h2 className="panel-title" style={{ fontSize: 'var(--text-xl)', marginBottom: '0.25rem' }}>
          Automatización y Mantenimiento Autónomo
        </h2>
        <p style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)', margin: 0 }}>
          Configura rutinas periódicas en Windows Task Scheduler que corren en segundo plano sin necesidad de abrir la aplicación.
        </p>

        {/* Selector de pestañas */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', borderBottom: '1px solid var(--color-rule)', paddingBottom: '0.75rem' }}>
          <button
            className={`btn ${activeTab === 'profiles' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: 'var(--text-sm)' }}
            onClick={() => { setActiveTab('profiles'); setEditingItem(null); }}
          >
            Perfiles de Mantenimiento
          </button>
          <button
            className={`btn ${activeTab === 'modules' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: 'var(--text-sm)' }}
            onClick={() => { setActiveTab('modules'); setEditingItem(null); }}
          >
            Escaneos por Módulo
          </button>
          <button
            className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: 'var(--text-sm)' }}
            onClick={() => { setActiveTab('history'); setEditingItem(null); }}
          >
            Historial de Ejecución ({history.length})
          </button>
        </div>
      </header>

      {/* PESTAÑA 1: PERFILES DE AUTOMATIZACIÓN */}
      {activeTab === 'profiles' && (
        <div>
          {/* Preajustes recomendados con 1 clic */}
          <section style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--color-paper-3)', borderRadius: 'var(--radius)', border: '1px solid var(--color-rule)' }}>
            <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Preajustes Recomendados (Activación Directa)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
              <div style={{ padding: '0.75rem', background: 'var(--color-paper)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-rule)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Mantenimiento Semanal</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', margin: '0.2rem 0 0.6rem' }}>
                  Perfil Dev: Domingos 03:00 AM
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: 'var(--text-xs)', padding: '0.35rem 0.6rem' }}
                  onClick={() => applyPreset('dev', '03:00', ['SUN'])}
                  disabled={savingSchedule}
                >
                  Programar Rutina
                </button>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--color-paper)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-rule)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Optimización Gaming</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', margin: '0.2rem 0 0.6rem' }}>
                  Perfil Gaming: Viernes y Sábados 18:00
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: 'var(--text-xs)', padding: '0.35rem 0.6rem' }}
                  onClick={() => applyPreset('gaming', '18:00', ['FRI', 'SAT'])}
                  disabled={savingSchedule}
                >
                  Programar Rutina
                </button>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--color-paper)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-rule)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Oficina & Telemetría</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', margin: '0.2rem 0 0.6rem' }}>
                  Perfil Oficina: Lunes 08:30 AM
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: 'var(--text-xs)', padding: '0.35rem 0.6rem' }}
                  onClick={() => applyPreset('work', '08:30', ['MON'])}
                  disabled={savingSchedule}
                >
                  Programar Rutina
                </button>
              </div>
            </div>
          </section>

          {/* Grilla de Perfiles */}
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: '1rem' }}>Perfiles Configurables</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            {AVAILABLE_PROFILES.map((prof) => {
              const taskInfo = scheduledProfiles.find((t) => t.profileId === prof.id);
              const isRegistered = Boolean(taskInfo);
              const profStatus = (taskInfo?.status || '').toLowerCase();
              const isEnabled = profStatus === 'ready' || profStatus === 'running';
              const isEditing = editingItem && editingItem.type === 'profile' && editingItem.id === prof.id;

              return (
                <div
                  key={prof.id}
                  style={{
                    border: `1px solid ${isRegistered ? 'var(--color-primary)' : 'var(--color-rule)'}`,
                    borderRadius: 'var(--radius)',
                    padding: '1.25rem',
                    background: 'var(--color-paper)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: prof.color }}>
                        {prof.name}
                      </span>
                      {isRegistered ? (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: isEnabled ? 'var(--color-success)' : 'var(--color-ink-3)',
                            background: isEnabled ? 'var(--color-success-soft)' : 'var(--color-paper-3)',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            border: `1px solid ${isEnabled ? 'var(--color-success)' : 'var(--color-rule)'}`,
                          }}
                        >
                          {taskInfo.status}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)' }}>No programada</span>
                      )}
                    </div>
                    <p style={{ color: 'var(--color-ink-2)', fontSize: 'var(--text-xs)', margin: '0 0 1rem', lineHeight: '1.4' }}>
                      {prof.desc}
                    </p>
                    {isRegistered && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', marginBottom: '1rem' }}>
                        Próxima ejecución: <strong>{taskInfo.nextRun || 'No especificada'}</strong>
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {isRegistered && (
                        <>
                          <button
                            className="btn btn-secondary"
                            style={{ width: 'auto', padding: '0.35rem 0.7rem', fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }}
                            onClick={() => handleDeleteProfile(taskInfo.taskName)}
                            disabled={toggling[taskInfo.taskName]}
                          >
                            Eliminar
                          </button>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              disabled={toggling[taskInfo.taskName]}
                              onChange={() => handleToggleProfile(taskInfo.taskName, taskInfo.status)}
                            />
                            <span className="slider"></span>
                          </label>
                        </>
                      )}
                      <button
                        className={`btn ${isRegistered ? 'btn-secondary' : 'btn-primary'}`}
                        style={{ width: 'auto', padding: '0.35rem 0.8rem', fontSize: 'var(--text-xs)' }}
                        onClick={() => isEditing ? closeScheduleEditor() : openScheduleEditor('profile', prof.id, prof.defaultTime, prof.defaultDays)}
                      >
                        {isEditing ? 'Cerrar' : isRegistered ? 'Modificar Horario' : 'Programar Tarea'}
                      </button>
                    </div>

                    {/* Editor en línea para este perfil */}
                    {isEditing && (
                      <div className="schedule-editor" style={{ marginTop: '1rem' }}>
                        <div className="schedule-editor-row">
                          <label className="form-label" style={{ marginBottom: 0 }}>Frecuencia:</label>
                          <div className="schedule-freq-toggle">
                            <button
                              className={`btn ${frequency === 'weekly' ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ width: 'auto', padding: '0.3rem 0.8rem', fontSize: 'var(--text-xs)' }}
                              onClick={() => setFrequency('weekly')}
                            >
                              Semanal
                            </button>
                            <button
                              className={`btn ${frequency === 'daily' ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ width: 'auto', padding: '0.3rem 0.8rem', fontSize: 'var(--text-xs)' }}
                              onClick={() => setFrequency('daily')}
                            >
                              Diaria
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
                              {WEEKDAYS.map((d) => (
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
                          <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>{scheduleError}</p>
                        )}

                        <div className="schedule-editor-row" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                          <button
                            className="btn btn-primary"
                            style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: 'var(--text-xs)' }}
                            onClick={saveSchedule}
                            disabled={savingSchedule}
                          >
                            {savingSchedule ? 'Guardando en Windows...' : 'Guardar en Task Scheduler'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PESTAÑA 2: ESCANEOS POR MÓDULO */}
      {activeTab === 'modules' && (
        <div style={{ overflowX: 'auto' }}>
          {tasks.length === 0 ? (
            <div className="empty-wrapper">
              <p>No se encontraron tareas de escaneo registradas.</p>
            </div>
          ) : (
            <table className="scheduler-table">
              <thead>
                <tr>
                  <th>Módulo</th>
                  <th>Próxima Ejecución</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const taskStatus = (task?.status || '').toLowerCase();
                  const isEnabled = taskStatus === 'ready' || taskStatus === 'running';
                  const isEditing = editingItem && editingItem.type === 'module' && editingItem.id === task.name;
                  return (
                    <Fragment key={task.name}>
                      <tr>
                        <td style={{ fontWeight: '500' }}>
                          {task.name.replace('_Weekly', '').replace('_Monthly', '')}
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', fontWeight: 'normal', marginTop: '0.2rem' }}>
                            {task.name}
                          </div>
                        </td>
                        <td style={{ color: 'var(--color-ink-3)', fontSize: '0.9rem' }}>
                          {task.nextRun || 'No programada'}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              color: isEnabled ? 'var(--color-success)' : 'var(--color-ink-3)',
                              background: isEnabled ? 'var(--color-success-soft)' : 'var(--color-paper-3)',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              border: `1px solid ${isEnabled ? 'var(--color-success)' : 'var(--color-rule)'}`,
                            }}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                              onClick={() => isEditing ? closeScheduleEditor() : openScheduleEditor('module', task.name)}
                            >
                              {isEditing ? 'Cerrar' : 'Configurar horario'}
                            </button>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                disabled={toggling[task.name]}
                                onChange={() => handleToggleModule(task.name, task.status)}
                              />
                              <span className="slider"></span>
                            </label>
                          </div>
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
                                    Diaria
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
                                    {WEEKDAYS.map((d) => (
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
                                <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{scheduleError}</p>
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PESTAÑA 3: HISTORIAL DE EJECUCIONES */}
      {activeTab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)', margin: 0 }}>
              Registro de tareas desatendidas ejecutadas por el Programador de Tareas.
            </p>
            <button className="btn btn-secondary" style={{ width: 'auto', fontSize: 'var(--text-xs)' }} onClick={() => fetchData()}>
              Actualizar
            </button>
          </div>

          {history.length === 0 ? (
            <div className="empty-wrapper" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-ink-3)' }}>
              No se han registrado ejecuciones programadas recientemente.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="scheduler-table">
                <thead>
                  <tr>
                    <th>Fecha y Hora</th>
                    <th>Perfil</th>
                    <th>Resultado</th>
                    <th>Resumen</th>
                    <th>Duración</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {new Date(h.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{h.profileId}</span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: h.success ? 'var(--color-success)' : 'var(--color-danger)',
                            background: h.success ? 'var(--color-success-soft)' : 'rgba(239, 68, 68, 0.1)',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                          }}
                        >
                          {h.success ? 'Éxito' : 'Falló'}
                        </span>
                      </td>
                      <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                        {h.summary} {h.error && <span style={{ color: 'var(--color-danger)' }}>({h.error})</span>}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {Number.isFinite(h.durationMs) ? `${(h.durationMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
