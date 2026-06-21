import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Marked } from 'marked';
import Terminal from './Terminal';
import LogViewer from './LogViewer';
import CommandPreview from './CommandPreview';
import { API_BASE } from '../config';
const marked = new Marked();

const MODULE_SCRIPTS = {
  updates: { scan: 'Check-Updates.ps1', action: 'Apply-Updates.ps1' },
  cleanup: { scan: 'Scan-Cleanup.ps1', action: 'Clean-Disk.ps1' },
  startup: { scan: 'Scan-Startup.ps1', action: 'Optimize-Startup.ps1' },
  ram: { scan: 'Scan-RAM.ps1', action: 'Free-RAM.ps1' },
};

export default function ReportViewer() {
  const { module } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Configuration States
  const [downloadsAgeDays, setDownloadsAgeDays] = useState(30);
  const [availablePrograms, setAvailablePrograms] = useState([]);
  const [selectedPrograms, setSelectedPrograms] = useState({});
  const [availableTasks, setAvailableTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState({});
  const [disabledPrograms, setDisabledPrograms] = useState([]);
  const [selectedEnablePrograms, setSelectedEnablePrograms] = useState({});
  const [disabledTasks, setDisabledTasks] = useState([]);
  const [selectedEnableTasks, setSelectedEnableTasks] = useState({});

  // RAM Optimizer States
  const [availableProcesses, setAvailableProcesses] = useState([]);
  const [unknownProcesses, setUnknownProcesses] = useState([]);
  const [riskyProcesses, setRiskyProcesses] = useState([]);
  const [selectedProcesses, setSelectedProcesses] = useState({});
  const [selectedUnknownProcesses, setSelectedUnknownProcesses] = useState({});
  const [selectedRiskyProcesses, setSelectedRiskyProcesses] = useState({});
  const [riskyAck, setRiskyAck] = useState(false);
  const [minRamMB, setMinRamMB] = useState(50);
  const [cleanMode, setCleanMode] = useState('soft');

  // Terminal & SSE States
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const sseControllerRef = useRef(null);

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/reports/${module}/latest`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('No se encontró ningún reporte reciente. Por favor ejecuta un escaneo primero.');
        }
        throw new Error('Error al obtener el reporte');
      }
      const data = await res.json();
      setReport(data);

      // Parse startup/RAM options (la misma funcion parsea ambos reportes)
      if ((module === 'startup' || module === 'ram') && data.content) {
        parseStartupItems(data.content);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    setLogs([]);
    setIsRunning(false);
    
    return () => {
      if (sseControllerRef.current) {
        sseControllerRef.current.abort();
      }
    };
  }, [module]);

  // Parse programs and tasks from markdown report
  const parseStartupItems = (markdown) => {
    const programs = [];
    const tasks = [];

    // Extract registry / folder startup programs
    const progMatch = markdown.match(/## Programas de inicio \(\d+\)\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (progMatch) {
      const lines = progMatch[1].split('\n');
      let currentSource = null;
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('[') && line.includes(']')) {
          const parts = line.split(']');
          currentSource = parts[0].substring(1).trim();
          const currentName = parts.slice(1).join(']').trim();
          if (currentName) {
            programs.push({ name: currentName, source: currentSource });
          }
        }
      }
    }

    // Extract enabled scheduled tasks
    const tasksMatch = markdown.match(/### Habilitadas \(\d+\)\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (tasksMatch) {
      const lines = tasksMatch[1].split('\n');
      for (let line of lines) {
        line = line.trim();
        if (line && !line.startsWith('###') && !line.startsWith('`')) {
          const parts = line.split('  ');
          const taskPathName = parts[0].trim();
          if (taskPathName) {
            const idx = taskPathName.lastIndexOf('\\');
            const name = idx >= 0 ? taskPathName.substring(idx + 1) : taskPathName;
            tasks.push({ fullName: taskPathName, name: name });
          }
        }
      }
    }

    // Extract disabled startup programs (separate section, separate list)
    const disabledProgs = [];
    const disabledProgMatch = markdown.match(/## Programas deshabilitados \(\d+\)\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (disabledProgMatch) {
      const lines = disabledProgMatch[1].split('\n');
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('[') && line.includes(']')) {
          const parts = line.split(']');
          const source = parts[0].substring(1).trim();
          const name = parts.slice(1).join(']').trim();
          if (name) disabledProgs.push({ name, source });
        }
      }
    }

    // Extract disabled scheduled tasks
    const disabledTasksList = [];
    const disabledTasksMatch = markdown.match(/### Deshabilitadas \(\d+\)\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (disabledTasksMatch) {
      const lines = disabledTasksMatch[1].split('\n');
      for (let line of lines) {
        line = line.trim();
        if (line && !line.startsWith('###') && !line.startsWith('`')) {
          const parts = line.split('  ');
          const taskPathName = parts[0].trim();
          if (taskPathName) {
            const idx = taskPathName.lastIndexOf('\\');
            const name = idx >= 0 ? taskPathName.substring(idx + 1) : taskPathName;
            disabledTasksList.push({ fullName: taskPathName, name: name });
          }
        }
      }
    }

    setAvailablePrograms(programs);
    setAvailableTasks(tasks);
    setDisabledPrograms(disabledProgs);
    setDisabledTasks(disabledTasksList);

    // Parse RAM identified processes (safe_known)
    const processes = [];
    const procMatch = markdown.match(/## Procesos identificados.*?\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (procMatch) {
      const lines = procMatch[1].split('\n');
      for (const line of lines) {
        const m = line.match(/\[\s*(\d+)\]\s+(.+?)\s+(\d+)\s+MB/);
        if (m) {
          processes.push({ pid: parseInt(m[1]), name: m[2].trim(), mb: parseInt(m[3]) });
        }
      }
    }
    setAvailableProcesses(processes);
    const initialProcState = {};
    processes.forEach((_, idx) => { initialProcState[idx] = false; });
    setSelectedProcesses(initialProcState);

    // Parse RAM unknown processes
    const unknown = [];
    const unknownMatch = markdown.match(/## Procesos no identificados.*?\r?\n\r?\n.*?\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (unknownMatch) {
      const lines = unknownMatch[1].split('\n');
      for (const line of lines) {
        const m = line.match(/\[\s*(\d+)\]\s+(.+?)\s+(\d+)\s+MB/);
        if (m) {
          unknown.push({ pid: parseInt(m[1]), name: m[2].trim(), mb: parseInt(m[3]) });
        }
      }
    }
    setUnknownProcesses(unknown);
    const initialUnknownState = {};
    unknown.forEach((_, idx) => { initialUnknownState[idx] = false; });
    setSelectedUnknownProcesses(initialUnknownState);

    // Parse RAM "no recomendados" processes - seleccionables a mano, bajo
    // confirmacion explicita del usuario (ver riskyAck), nunca via "todos".
    const riskyProcesses = [];
    const riskyMatch = markdown.match(/## Procesos no recomendados.*?\r?\n\r?\n.*?\r?\n\r?\n```\r?\n([\s\S]*?)```/);
    if (riskyMatch) {
      const lines = riskyMatch[1].split('\n');
      for (const line of lines) {
        const m = line.match(/\[\s*(\d+)\]\s+(.+?)\s+(\d+)\s+MB/);
        if (m) {
          riskyProcesses.push({ pid: parseInt(m[1]), name: m[2].trim(), mb: parseInt(m[3]) });
        }
      }
    }
    setRiskyProcesses(riskyProcesses);
    const initialRiskyState = {};
    riskyProcesses.forEach((_, idx) => { initialRiskyState[idx] = false; });
    setSelectedRiskyProcesses(initialRiskyState);
    setRiskyAck(false);

    // Initialize all checkboxes to false
    const initialProgState = {};
    programs.forEach((_, idx) => { initialProgState[idx] = false; });
    setSelectedPrograms(initialProgState);

    const initialTaskState = {};
    tasks.forEach((_, idx) => { initialTaskState[idx] = false; });
    setSelectedTasks(initialTaskState);

    const initialEnableProgState = {};
    disabledProgs.forEach((_, idx) => { initialEnableProgState[idx] = false; });
    setSelectedEnablePrograms(initialEnableProgState);

    const initialEnableTaskState = {};
    disabledTasksList.forEach((_, idx) => { initialEnableTaskState[idx] = false; });
    setSelectedEnableTasks(initialEnableTaskState);
  };

  const handleCheckboxChange = (type, index) => {
    if (type === 'program') {
      setSelectedPrograms(prev => ({ ...prev, [index]: !prev[index] }));
    } else if (type === 'task') {
      setSelectedTasks(prev => ({ ...prev, [index]: !prev[index] }));
    } else if (type === 'enableProgram') {
      setSelectedEnablePrograms(prev => ({ ...prev, [index]: !prev[index] }));
    } else if (type === 'enableTask') {
      setSelectedEnableTasks(prev => ({ ...prev, [index]: !prev[index] }));
    }
  };

  const buildCommandPreview = (isAction) => {
    const scripts = MODULE_SCRIPTS[module];
    if (!scripts) return [];

    const envLines = [];
    if (isAction) {
      envLines.push('$env:AUTO_CONFIRM = "true"');
    }
    if (module === 'cleanup') {
      envLines.push(`$env:DOWNLOADS_AGE_DAYS = "${downloadsAgeDays}"`);
    }
    if (isAction && module === 'startup') {
      const checkedProgs = Object.keys(selectedPrograms)
        .filter(k => selectedPrograms[k])
        .map(k => parseInt(k) + 1);
      const checkedTasks = Object.keys(selectedTasks)
        .filter(k => selectedTasks[k])
        .map(k => parseInt(k) + 1);
      const checkedEnableProgs = Object.keys(selectedEnablePrograms)
        .filter(k => selectedEnablePrograms[k])
        .map(k => parseInt(k) + 1);
      const checkedEnableTasks = Object.keys(selectedEnableTasks)
        .filter(k => selectedEnableTasks[k])
        .map(k => parseInt(k) + 1);
      envLines.push(`$env:OPTIMIZE_PROGRAMS = "${checkedProgs.length ? checkedProgs.join(',') : '(ninguno)'}"`);
      envLines.push(`$env:OPTIMIZE_TASKS = "${checkedTasks.length ? checkedTasks.join(',') : '(ninguno)'}"`);
      envLines.push(`$env:ENABLE_PROGRAMS = "${checkedEnableProgs.length ? checkedEnableProgs.join(',') : '(ninguno)'}"`);
      envLines.push(`$env:ENABLE_TASKS = "${checkedEnableTasks.length ? checkedEnableTasks.join(',') : '(ninguno)'}"`);
    }
    if (module === 'ram') {
      if (!isAction) {
        envLines.push(`$env:MIN_RAM_MB = "${minRamMB}"`);
        envLines.push(`$env:CLEAN_MODE = "${cleanMode}"`);
      }
    }
    if (isAction && module === 'ram') {
      const checkedProcs = Object.keys(selectedProcesses)
        .filter(k => selectedProcesses[k])
        .map(k => availableProcesses[parseInt(k)]?.pid)
        .filter(Boolean);
      envLines.push(`$env:OPTIMIZE_PROCESSES = "${checkedProcs.length ? checkedProcs.join(',') : '(ninguno)'}"`);
      const checkedUnknown = Object.keys(selectedUnknownProcesses)
        .filter(k => selectedUnknownProcesses[k])
        .map(k => unknownProcesses[parseInt(k)]?.pid)
        .filter(Boolean);
      envLines.push(`$env:UNKNOWN_PROCESSES = "${checkedUnknown.length ? checkedUnknown.join(',') : '(ninguno)'}"`);
      const checkedRisky = riskyAck
        ? Object.keys(selectedRiskyProcesses).filter(k => selectedRiskyProcesses[k]).map(k => riskyProcesses[parseInt(k)]?.pid).filter(Boolean)
        : [];
      envLines.push(`$env:RISKY_PROCESSES = "${checkedRisky.length ? checkedRisky.join(',') : '(ninguno)'}"`);
      envLines.push(`$env:MIN_RAM_MB = "${minRamMB}"`);
      envLines.push(`$env:CLEAN_MODE = "${cleanMode}"`);
    }

    const script = isAction ? scripts.action : scripts.scan;
    const cmd = `powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -File ${script}`;
    return [...envLines, cmd];
  };

  const runScan = () => {
    const body = {};
    if (module === 'cleanup') body.downloadsAgeDays = downloadsAgeDays;
    if (module === 'ram') {
      body.cleanMode = cleanMode;
      // Mismo umbral que se manda en runAction() - el scan y la accion deben
      // usar el mismo valor, o los indices marcados en el reporte podrian
      // referirse a un proceso distinto al ejecutar la accion.
      body.minRamMB = minRamMB;
    }
    triggerExecution(`/scan/${module}`, body);
  };

  const runAction = () => {
    const body = { autoConfirm: true };
    if (module === 'cleanup') {
      body.downloadsAgeDays = downloadsAgeDays;
    } else if (module === 'startup') {
      // Collect 1-based indices for checked items
      const checkedProgs = Object.keys(selectedPrograms)
        .filter(k => selectedPrograms[k])
        .map(k => parseInt(k) + 1);
      
      const checkedTasks = Object.keys(selectedTasks)
        .filter(k => selectedTasks[k])
        .map(k => parseInt(k) + 1);

      body.programs = checkedProgs.length === 0 ? '' : checkedProgs.join(',');
      body.tasks = checkedTasks.length === 0 ? '' : checkedTasks.join(',');

      const checkedEnableProgs = Object.keys(selectedEnablePrograms)
        .filter(k => selectedEnablePrograms[k])
        .map(k => parseInt(k) + 1);

      const checkedEnableTasks = Object.keys(selectedEnableTasks)
        .filter(k => selectedEnableTasks[k])
        .map(k => parseInt(k) + 1);

      body.enablePrograms = checkedEnableProgs.length === 0 ? '' : checkedEnableProgs.join(',');
      body.enableTasks = checkedEnableTasks.length === 0 ? '' : checkedEnableTasks.join(',');
    } else if (module === 'ram') {
      // Se manda el PID real (no la posicion en la lista): si solo se
      // mandara la posicion, un proceso que cambio de orden entre el
      // escaneo y este clic (su MB vario un poco) haria que el indice
      // apunte a un proceso distinto al que el usuario vio y marco.
      const checkedProcs = Object.keys(selectedProcesses)
        .filter(k => selectedProcesses[k])
        .map(k => availableProcesses[parseInt(k)]?.pid)
        .filter(Boolean);
      body.processes = checkedProcs.length === 0 ? '' : checkedProcs.join(',');
      const checkedUnknown = Object.keys(selectedUnknownProcesses)
        .filter(k => selectedUnknownProcesses[k])
        .map(k => unknownProcesses[parseInt(k)]?.pid)
        .filter(Boolean);
      body.unknownProcesses = checkedUnknown.length === 0 ? '' : checkedUnknown.join(',');
      // Los procesos "no recomendados" solo se mandan si el usuario marco el
      // checkbox de confirmacion explicita (riskyAck) - de lo contrario se
      // ignoran aunque tengan checkboxes individuales marcados.
      const checkedRisky = riskyAck
        ? Object.keys(selectedRiskyProcesses).filter(k => selectedRiskyProcesses[k]).map(k => riskyProcesses[parseInt(k)]?.pid).filter(Boolean)
        : [];
      body.riskyProcesses = checkedRisky.length === 0 ? '' : checkedRisky.join(',');
      body.minRamMB = minRamMB;
      body.cleanMode = cleanMode;
    }

    triggerExecution(`/action/${module}`, body);
  };

  const triggerExecution = (endpoint, body) => {
    if (isRunning) {
      console.warn('triggerExecution blocked: ya hay una tarea en ejecucion');
      return;
    }
    
    setProgress(null);
    setIsRunning(true);
    setLogs([{ type: 'system', text: `[SISTEMA] Iniciando ejecucion de ${endpoint.startsWith('/scan/') ? 'escaneo' : 'acciones'}...` }]);

    const ctrl = new AbortController();
    sseControllerRef.current = ctrl;

    const timeoutMs = endpoint.startsWith('/action/') ? 660000 : 330000;
    const timeoutId = setTimeout(() => {
      setLogs(prev => [...prev, { type: 'error', text: '[ERROR] Timeout: la operacion excedio el tiempo limite.' }]);
      ctrl.abort();
    }, timeoutMs);

    fetchEventSource(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      openWhenHidden: true,
      onmessage(event) {
        if (event.event === 'progress') {
          try { setProgress(JSON.parse(event.data)); } catch {}
        } else if (event.event === 'output') {
          setLogs(prev => [...prev, { type: 'output', text: event.data }]);
        } else if (event.event === 'error') {
          setLogs(prev => [...prev, { type: 'error', text: event.data }]);
        } else if (event.event === 'done') {
          try {
            const { exitCode, timedOut } = JSON.parse(event.data);
            const statusText = exitCode === 0
              ? 'Proceso completado exitosamente.'
              : `Proceso terminado con codigo de salida: ${exitCode === null ? 'desconocido' : exitCode}.`;
            
            setLogs(prev => [...prev, { 
              type: 'system', 
              text: `\n[SISTEMA] ${statusText} ${timedOut ? '(Excedio el tiempo limite)' : ''}` 
            }]);
          } catch (parseErr) {
            setLogs(prev => [...prev, { type: 'error', text: `[ERROR] Respuesta inesperada del servidor: ${parseErr.message}` }]);
          }
          
          clearTimeout(timeoutId);
          setIsRunning(false);
          setProgress(null);
          ctrl.abort();

          fetchReport();
          if (window.onDoneRefreshStatus) {
            window.onDoneRefreshStatus();
          }
        }
      },
      onclose() {
        clearTimeout(timeoutId);
        setIsRunning(false);
        setProgress(null);
        setLogs(prev => [...prev, { type: 'system', text: '\n[SISTEMA] Conexion cerrada por el servidor.' }]);
        
        fetchReport();
        if (window.onDoneRefreshStatus) {
          window.onDoneRefreshStatus();
        }
      },
      onerror(err) {
        clearTimeout(timeoutId);
        setLogs(prev => [...prev, { type: 'error', text: `[ERROR] Error de comunicacion: ${err.message}` }]);
        setIsRunning(false);
        setProgress(null);
        ctrl.abort();
        throw err;
      }
    });
  };

  const abortExecution = () => {
    if (sseControllerRef.current) {
      sseControllerRef.current.abort();
      setLogs(prev => [...prev, { type: 'system', text: '\n[SISTEMA] Operación cancelada por el operador.' }]);
      setIsRunning(false);
      setProgress(null);
    }
  };

  const getModuleTitle = () => {
    switch(module) {
      case 'updates': return 'Actualizaciones pendientes';
      case 'cleanup': return 'Limpieza de disco';
      case 'startup': return 'Optimización de inicio';
      case 'ram': return 'Optimización de RAM';
      default: return 'Detalles del Módulo';
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.5rem 1rem' }} onClick={() => navigate('/')}>
            ← Volver al Dashboard
          </button>
        </div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: '700' }}>{getModuleTitle()}</h1>
      </div>

      <div className="report-container">
        {/* Main report viewer */}
        <div className="glass-panel markdown-body">
          {loading ? (
            <div>
              <div className="skeleton" style={{ width: '60%', height: '32px', marginBottom: '1.5rem' }} />
              <div className="skeleton" style={{ width: '100%', height: '18px', marginBottom: '0.8rem' }} />
              <div className="skeleton" style={{ width: '90%', height: '18px', marginBottom: '0.8rem' }} />
              <div className="skeleton" style={{ width: '95%', height: '18px', marginBottom: '0.8rem' }} />
              <div className="skeleton" style={{ width: '40%', height: '150px', marginTop: '2rem' }} />
            </div>
          ) : error ? (
            <div className="error-wrapper" style={{ padding: 0 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--warning)', marginBottom: '1rem'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <h3>No hay reporte disponible</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>{error}</p>
            </div>
          ) : (
            <div 
              className="markdown-content" 
              dangerouslySetInnerHTML={{ __html: marked.parse(report.content || '') }} 
            />
          )}
        </div>

        {/* Sidebar Actions & Configurations */}
        <div className="glass-panel options-panel">
          <h2 className="panel-title">Acciones de Control</h2>
          
          <div className="form-group">
            <button className="btn btn-secondary" onClick={runScan} disabled={isRunning}>
              Escanear módulo
            </button>
          </div>

          <CommandPreview lines={buildCommandPreview(false)} />

          <div style={{ height: '1px', background: 'var(--border-color)', margin: '1.5rem 0' }} />

          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', fontWeight: '600' }}>Configurar Ejecución</h3>

          {module === 'cleanup' && (
            <div className="form-group">
              <label className="form-label">Antigüedad de descargas a borrar:</label>
              <input 
                type="range" 
                min="1" 
                max="365" 
                value={downloadsAgeDays} 
                onChange={(e) => setDownloadsAgeDays(parseInt(e.target.value))}
                className="range-slider"
                disabled={isRunning}
              />
              <div className="range-value">{downloadsAgeDays} días</div>
            </div>
          )}

          {module === 'startup' && (
            <>
              {availablePrograms.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Programas de Inicio a Deshabilitar:</label>
                  <div className="checkbox-list">
                    {availablePrograms.map((prog, idx) => (
                      <label key={idx} className="checkbox-item">
                        <input 
                          type="checkbox" 
                          checked={selectedPrograms[idx] || false}
                          onChange={() => handleCheckboxChange('program', idx)}
                          disabled={isRunning}
                        />
                        <span className="checkbox-label" title={prog.name}>
                          {prog.name}
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {prog.source}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableTasks.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Tareas Programadas a Deshabilitar:</label>
                  <div className="checkbox-list">
                    {availableTasks.map((task, idx) => (
                      <label key={idx} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedTasks[idx] || false}
                          onChange={() => handleCheckboxChange('task', idx)}
                          disabled={isRunning}
                        />
                        <span className="checkbox-label" title={task.fullName}>
                          {task.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(disabledPrograms.length > 0 || disabledTasks.length > 0) && (
                <div className="disabled-items-section">
                  <div style={{ height: '1px', background: 'var(--border-color)', margin: '1.5rem 0' }} />
                  <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: '600' }}>
                    Deshabilitados
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                    Marca lo que quieras reactivar.
                  </p>

                  {disabledPrograms.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Programas deshabilitados:</label>
                      <div className="checkbox-list">
                        {disabledPrograms.map((prog, idx) => (
                          <label key={idx} className="checkbox-item">
                            <input
                              type="checkbox"
                              checked={selectedEnablePrograms[idx] || false}
                              onChange={() => handleCheckboxChange('enableProgram', idx)}
                              disabled={isRunning}
                            />
                            <span className="checkbox-label" title={prog.name}>
                              {prog.name}
                              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {prog.source}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {disabledTasks.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Tareas deshabilitadas:</label>
                      <div className="checkbox-list">
                        {disabledTasks.map((task, idx) => (
                          <label key={idx} className="checkbox-item">
                            <input
                              type="checkbox"
                              checked={selectedEnableTasks[idx] || false}
                              onChange={() => handleCheckboxChange('enableTask', idx)}
                              disabled={isRunning}
                            />
                            <span className="checkbox-label" title={task.fullName}>
                              {task.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {module === 'ram' && (
            <>
              <div className="form-group">
                <label className="form-label">Modo de limpieza:</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <button
                    className={`btn btn-sm${cleanMode === 'soft' ? ' btn-primary' : ''}`}
                    onClick={() => { setCleanMode('soft'); setMinRamMB(50); }}
                    disabled={isRunning}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', flex: 1 }}
                  >
                    Suave
                  </button>
                  <button
                    className={`btn btn-sm${cleanMode === 'deep' ? ' btn-primary' : ''}`}
                    onClick={() => { setCleanMode('deep'); setMinRamMB(10); }}
                    disabled={isRunning}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', flex: 1 }}
                  >
                    Profundo
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {cleanMode === 'soft'
                    ? 'Solo procesos identificados seguros (>= umbral).'
                    : 'Incluye procesos no identificados sin ventana visible (>= 10 MB).'}
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Umbral mínimo de RAM (MB):</label>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={minRamMB}
                  onChange={(e) => setMinRamMB(parseInt(e.target.value))}
                  className="range-slider"
                  disabled={isRunning}
                />
                <div className="range-value">{minRamMB} MB</div>
              </div>

              {availableProcesses.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Procesos identificados a liberar:</label>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const all = {};
                        availableProcesses.forEach((_, idx) => { all[idx] = true; });
                        setSelectedProcesses(all);
                      }}
                      disabled={isRunning}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                    >
                      Seleccionar todos
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        const none = {};
                        availableProcesses.forEach((_, idx) => { none[idx] = false; });
                        setSelectedProcesses(none);
                      }}
                      disabled={isRunning}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                    >
                      Deseleccionar todos
                    </button>
                  </div>
                  <div className="checkbox-list">
                    {availableProcesses.map((proc, idx) => (
                      <label key={idx} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedProcesses[idx] || false}
                          onChange={() => {
                            setSelectedProcesses(prev => ({ ...prev, [idx]: !prev[idx] }));
                          }}
                          disabled={isRunning}
                        />
                        <span className="checkbox-label" title={proc.name}>
                          {proc.name}
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            PID: {proc.pid} — {proc.mb} MB
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {unknownProcesses.length > 0 && (
                <div className="form-group" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <label className="form-label" style={{ color: 'var(--warning-color, #e0a32a)' }}>
                    Procesos no identificados:
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginBottom: '0.75rem' }}>
                    Procesos en segundo plano sin descripcion conocida. No se incluyen en "Seleccionar todos".
                    Revise antes de liberar, bajo su responsabilidad.
                  </p>
                  <div className="checkbox-list">
                    {unknownProcesses.map((proc, idx) => (
                      <label key={idx} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedUnknownProcesses[idx] || false}
                          onChange={() => {
                            setSelectedUnknownProcesses(prev => ({ ...prev, [idx]: !prev[idx] }));
                          }}
                          disabled={isRunning}
                        />
                        <span className="checkbox-label" title={proc.name}>
                          {proc.name}
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            PID: {proc.pid} — {proc.mb} MB
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {riskyProcesses.length > 0 && (
                <div className="form-group" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <label className="form-label" style={{ color: 'var(--danger, #e05a5a)' }}>
                    No recomendado (editores/navegadores/sync/chat):
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Cerrarlos sin guardar pierde tu trabajo o sesión. Nunca se incluyen en "Seleccionar todos" ni se
                    preseleccionan — marca abajo solo si reconoces el proceso y estás seguro de cerrarlo.
                  </p>
                  <label className="checkbox-item" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={riskyAck}
                      onChange={() => setRiskyAck(prev => !prev)}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" style={{ color: 'var(--danger, #e05a5a)' }}>
                      Entiendo el riesgo y quiero poder cerrar procesos de esta lista
                    </span>
                  </label>
                  <div className="checkbox-list">
                    {riskyProcesses.map((proc, idx) => (
                      <label key={idx} className="checkbox-item" style={{ opacity: riskyAck ? 1 : 0.5 }}>
                        <input
                          type="checkbox"
                          checked={selectedRiskyProcesses[idx] || false}
                          onChange={() => {
                            setSelectedRiskyProcesses(prev => ({ ...prev, [idx]: !prev[idx] }));
                          }}
                          disabled={isRunning || !riskyAck}
                        />
                        <span className="checkbox-label" title={proc.name}>
                          {proc.name}
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            PID: {proc.pid} — {proc.mb} MB
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <CommandPreview lines={buildCommandPreview(true)} />

          <div className="form-group" style={{ marginTop: '2rem' }}>
            <button className="btn btn-primary" onClick={runAction} disabled={isRunning}>
              Ejecutar acciones
            </button>
          </div>
        </div>

        {/* Real-time stdout console logs */}
        <Terminal logs={logs} isRunning={isRunning} onAbort={abortExecution} progress={progress} />

        {/* Historical action log */}
        <LogViewer module={module} />
      </div>
    </div>
  );
}
