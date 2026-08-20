import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import Terminal from './Terminal';
import LogViewer from './LogViewer';
import ItemCheckboxList from './ItemCheckboxList';
import { GENERIC_PANEL_CONFIG } from './panelConfig';
import { API_BASE } from '../config';
import { renderReport } from '../lib/markdown';
import { MODULES } from '../modules';
import { useModuleItems, GENERIC_MODULES } from '../hooks/useModuleItems';

const CleanupBreakdownChart = lazy(() => import('./CleanupBreakdownChart'));

// Las 9 categorías de limpieza y optimización segura de almacenamiento
const CLEAN_CATEGORIES = [
  { key: 'temp', label: 'Archivos temporales', hint: '%TEMP% y Windows\\Temp', safety: 'SAFE' },
  { key: 'windowsUpdate', label: 'Windows Update Cache', hint: 'Instaladores descargados ya aplicados', safety: 'SAFE' },
  { key: 'crashDumps', label: 'Volcados de error y WER', hint: 'Crash dumps y reportes pasados', safety: 'SAFE' },
  { key: 'devCache', label: 'Cachés de desarrollo', hint: 'npm, pip, yarn, nuget, vscode', safety: 'SAFE' },
  { key: 'shaderCache', label: 'Caché de Shaders GPU', hint: 'DirectX, Vulkan, NVIDIA, AMD', safety: 'SAFE' },
  { key: 'browserCache', label: 'Caché de navegadores', hint: 'Chrome, Edge, Brave y Firefox (sin cookies)', safety: 'SAFE' },
  { key: 'thumbnails', label: 'Miniaturas de Explorer', hint: 'Caché de vistas previas de archivos', safety: 'SAFE' },
  { key: 'recycle', label: 'Papelera de reciclaje', hint: 'Vacía la papelera del sistema', safety: 'CAUTION' },
  { key: 'downloads', label: 'Descargas antiguas', hint: 'Archivos viejos en la carpeta Descargas', safety: 'CAUTION' },
];

export default function ReportViewer() {
  const { module } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  // Sin memo, marked re-parseaba el reporte entero en cada setLogs del SSE,
  // o sea decenas de veces por segundo mientras corre una accion.
  const reportHtml = useMemo(() => renderReport(report?.content), [report?.content]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCopyReport = async () => {
    if (!report?.content) return;
    try {
      await navigator.clipboard.writeText(report.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // ── Hook genérico para los 14 módulos con patrón items/selected ──
  const generic = useModuleItems(module);

  // ── Estados especiales: solo los módulos que NO encajan en el genérico ──

  // Cleanup
  const [downloadsAgeDays, setDownloadsAgeDays] = useState(30);
  const [availableCategories, setAvailableCategories] = useState(CLEAN_CATEGORIES);
  const [selectedCategories, setSelectedCategories] = useState({});

  // Startup (4 listas separadas)
  const [availablePrograms, setAvailablePrograms] = useState([]);
  const [selectedPrograms, setSelectedPrograms] = useState({});
  const [availableTasks, setAvailableTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState({});
  const [disabledPrograms, setDisabledPrograms] = useState([]);
  const [selectedEnablePrograms, setSelectedEnablePrograms] = useState({});
  const [disabledTasks, setDisabledTasks] = useState([]);
  const [selectedEnableTasks, setSelectedEnableTasks] = useState({});

  // RAM (3 tiers + controles)
  const [availableProcesses, setAvailableProcesses] = useState([]);
  const [unknownProcesses, setUnknownProcesses] = useState([]);
  const [riskyProcesses, setRiskyProcesses] = useState([]);
  const [selectedProcesses, setSelectedProcesses] = useState({});
  const [selectedUnknownProcesses, setSelectedUnknownProcesses] = useState({});
  const [selectedRiskyProcesses, setSelectedRiskyProcesses] = useState({});
  const [riskyAck, setRiskyAck] = useState(false);
  const [minRamMB, setMinRamMB] = useState(50);
  const [cleanMode, setCleanMode] = useState('soft');

  // Power (botones, no checkboxes)
  const [powerPlans, setPowerPlans] = useState([]);

  // Adblock
  const [adblockSources, setAdblockSources] = useState([]);
  const [selectedSources, setSelectedSources] = useState({});

  // Network
  const [bufferbloat, setBufferbloat] = useState(false);

  // OEM debloat mode selector
  const [oemMode, setOemMode] = useState('demand');

  // Terminal & SSE States
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const sseControllerRef = useRef(null);

  const noneChecked = (list) => Object.fromEntries(list.map((_, i) => [i, false]));

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
      await loadItems();
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

  // ── Cargar items del último escaneo ──
  const clearSpecialItems = () => {
    if (module === 'cleanup') {
      setAvailableCategories(CLEAN_CATEGORIES);
      setSelectedCategories({});
    } else if (module === 'startup') {
      setAvailablePrograms([]); setSelectedPrograms({});
      setAvailableTasks([]); setSelectedTasks({});
      setDisabledPrograms([]); setSelectedEnablePrograms({});
      setDisabledTasks([]); setSelectedEnableTasks({});
    } else if (module === 'ram') {
      setAvailableProcesses([]); setSelectedProcesses({});
      setUnknownProcesses([]); setSelectedUnknownProcesses({});
      setRiskyProcesses([]); setSelectedRiskyProcesses({});
    } else if (module === 'power') {
      setPowerPlans([]);
    } else if (module === 'adblock') {
      setAdblockSources([]); setSelectedSources({});
    }
  };

  const loadItems = async () => {
    // Módulos genéricos: delegar al hook
    if (GENERIC_MODULES.has(module)) {
      await generic.load();
      return;
    }

    const res = await fetch(`${API_BASE}/reports/${module}/items`);
    if (!res.ok) { clearSpecialItems(); return; }
    const { items } = await res.json();

    if (module === 'cleanup' && Array.isArray(items)) {
      setAvailableCategories(items);
    } else if (module === 'startup') {
      setAvailablePrograms(items.programs || []);
      setSelectedPrograms(noneChecked(items.programs || []));
      setAvailableTasks(items.tasks || []);
      setSelectedTasks(noneChecked(items.tasks || []));
      setDisabledPrograms(items.disabledPrograms || []);
      setSelectedEnablePrograms(noneChecked(items.disabledPrograms || []));
      setDisabledTasks(items.disabledTasks || []);
      setSelectedEnableTasks(noneChecked(items.disabledTasks || []));
    } else if (module === 'ram') {
      setAvailableProcesses(items.known || []);
      setSelectedProcesses(noneChecked(items.known || []));
      setUnknownProcesses(items.unknown || []);
      setSelectedUnknownProcesses(noneChecked(items.unknown || []));
      setRiskyProcesses(items.risky || []);
      setSelectedRiskyProcesses(noneChecked(items.risky || []));
    } else if (module === 'power') {
      setPowerPlans(Array.isArray(items) ? items : []);
    } else if (module === 'adblock') {
      setAdblockSources(items.fuentes || []);
      setSelectedSources(Object.fromEntries((items.fuentes || []).map((_, i) => [i, true])));
    } else {
      clearSpecialItems();
    }
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

  const switchToPlan = (planGuid) => {
    triggerExecution('/action/power', { planGuid });
  };

  // ── Scan ──
  const runScan = () => {
    const body = {};
    if (module === 'cleanup') body.downloadsAgeDays = downloadsAgeDays;
    if (module === 'network') body.bufferbloat = bufferbloat;
    if (module === 'ram') {
      body.cleanMode = cleanMode;
      body.minRamMB = minRamMB;
    }
    triggerExecution(`/scan/${module}`, body);
  };

  // ── Action ──
  const runAction = ({ dryRun = false, adblockAction } = {}) => {
    const body = dryRun ? { dryRun: true } : {};

    // Módulos genéricos: construir body desde el hook
    const panelCfg = GENERIC_PANEL_CONFIG[module];
    if (GENERIC_MODULES.has(module) && panelCfg) {
      const checked = generic.buildChecked();
      if (panelCfg.bodyFormat === 'csv-raw') {
        // contextmenu: los IDs ya son las regPaths completas
        body[panelCfg.bodyKey] = checked.join(',');
      } else if (panelCfg.bodyFormat === 'csv') {
        body[panelCfg.bodyKey] = checked.length === 0 ? '' : checked.join(',');
      } else {
        body[panelCfg.bodyKey] = checked;
      }
      if (module === 'oemdebloat') body.mode = oemMode;
      triggerExecution(`/action/${module}`, body);
      return;
    }

    // Módulos especiales
    if (module === 'adblock') {
      body.adblockAction = adblockAction || 'apply';
      body.sources = adblockSources
        .filter((_, i) => selectedSources[i])
        .map((f) => f.id);
    }
    if (module === 'cleanup') {
      body.downloadsAgeDays = downloadsAgeDays;
      body.cleanCategories = availableCategories
        .filter((c) => selectedCategories[c.key])
        .map((c) => c.key);
    } else if (module === 'startup') {
      const pickedIds = (selection, list) => Object.keys(selection)
        .filter(k => selection[k])
        .map(k => list[parseInt(k)]?.id)
        .filter(Boolean);

      body.programs = pickedIds(selectedPrograms, availablePrograms);
      body.tasks = pickedIds(selectedTasks, availableTasks);
      body.enablePrograms = pickedIds(selectedEnablePrograms, disabledPrograms);
      body.enableTasks = pickedIds(selectedEnableTasks, disabledTasks);
    } else if (module === 'ram') {
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
      const checkedRisky = riskyAck
        ? Object.keys(selectedRiskyProcesses).filter(k => selectedRiskyProcesses[k]).map(k => riskyProcesses[parseInt(k)]?.pid).filter(Boolean)
        : [];
      body.riskyProcesses = checkedRisky.length === 0 ? '' : checkedRisky.join(',');
      body.minRamMB = minRamMB;
      body.cleanMode = cleanMode;
    }

    triggerExecution(`/action/${module}`, body);
  };

  // ── SSE execution engine (sin cambios funcionales) ──
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
          try { setProgress(JSON.parse(event.data)); } catch { /* progreso mal formado: se ignora */ }
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

  const getModuleTitle = () => MODULES[module]?.label || 'Detalles del Módulo';

  // ── Panel genérico para los 14 módulos con patrón items/selected ──
  const renderGenericPanel = () => {
    const panelCfg = GENERIC_PANEL_CONFIG[module];
    if (!panelCfg || !GENERIC_MODULES.has(module)) return null;

    // OEM debloat tiene un mode selector extra
    const oemModeSelector = module === 'oemdebloat' && generic.items.length > 0 && (
      <>
        <label className="form-label">Modo de optimización:</label>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn ${oemMode === 'demand' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => setOemMode('demand')}
            disabled={isRunning}
          >
            Manual (Recomendado)
          </button>
          <button
            type="button"
            className={`btn ${oemMode === 'disable' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
            onClick={() => setOemMode('disable')}
            disabled={isRunning}
          >
            Deshabilitar
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
          Seleccioná los servicios a configurar en inicio {oemMode === 'demand' ? 'Manual' : 'Deshabilitado'}:
        </p>
      </>
    );

    return (
      <>
        {oemModeSelector}
        <ItemCheckboxList
          items={generic.items}
          selected={generic.selected}
          toggle={generic.toggle}
          isRunning={isRunning}
          label={module === 'oemdebloat' ? 'Servicios OEM detectados:' : panelCfg.label}
          hint={module === 'oemdebloat' ? undefined : panelCfg.hint}
          renderItem={panelCfg.renderItem}
          filterFn={panelCfg.filterFn}
        />
      </>
    );
  };

  // ── Textos del hint por módulo en el sidebar ──
  const SCAN_HINTS = {
    updates: 'Busca actualizaciones de winget, pip, npm y Chocolatey. No instala nada sin tu confirmación.',
    cleanup: 'Mide espacio recuperable en temporales, caché de navegadores, descargas y papelera. Solo lectura.',
    startup: 'Analiza programas, servicios y tareas que se inician con tu sesión. Deshabilitar es reversible.',
    ram: 'Escanea procesos por consumo de RAM, los clasifica por riesgo (seguro/riesgoso/crítico) y te permite liberar memoria de forma selectiva.',
    network: 'Mide jitter, pérdida, latencia por salto, MTU y DNS. La acción solo limpia la caché DNS: no reduce la latencia.',
    services: 'Lista servicios con inicio automático, separa MS de terceros. Permite detener y deshabilitar servicios que no necesites.',
    power: 'Muestra el plan de energía activo, estado de batería y consumo estimado. Permite cambiar de plan al instante.',
    apps: 'Lista aplicaciones instaladas vía winget y permite desinstalar varias a la vez de forma silenciosa.',
    privacy: 'Revisa 8 ajustes de privacidad (telemetría, Cortana, ubicación, etc.) y los protege con un clic.',
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.8rem' }} onClick={() => navigate('/')}>
            ← Volver al Dashboard
          </button>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '700', margin: 0 }}>{getModuleTitle()}</h1>
        </div>
        {report?.content && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleCopyReport}
            title="Copiar reporte en formato Markdown al portapapeles"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {copied ? '¡Copiado!' : 'Copiar Markdown'}
          </button>
        )}
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
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-warning)', marginBottom: '1rem'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <h3>No hay reporte disponible</h3>
              <p style={{ color: 'var(--color-ink-3)', marginTop: '0.5rem' }}>{error}</p>
            </div>
          ) : (
            <>
              {report?.content && MODULES[module]?.description && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-ink-3)', padding: '0 0 1rem 0', lineHeight: '1.4', borderBottom: '1px solid var(--color-rule)', marginBottom: '1rem' }}>
                  {MODULES[module].description}
                </div>
              )}
              {module === 'cleanup' && (
                <Suspense fallback={<div className="skeleton" style={{ height: 200, marginBottom: 'var(--space-6)' }} />}>
                  <CleanupBreakdownChart
                    categories={availableCategories}
                    selected={selectedCategories}
                    onToggleCategory={(k) => setSelectedCategories((prev) => ({ ...prev, [k]: !prev[k] }))}
                    onSelectAllSafe={() => {
                      const next = {};
                      availableCategories.forEach((c) => { if (c.safety === 'SAFE') next[c.key] = true; });
                      setSelectedCategories(next);
                    }}
                    onDeselectAll={() => setSelectedCategories({})}
                  />
                </Suspense>
              )}
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: reportHtml }}
              />
            </>
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

          {SCAN_HINTS[module] && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', padding: '0 0 0.75rem 0', lineHeight: '1.4' }}>
              {SCAN_HINTS[module]}
            </div>
          )}

          <div style={{ height: '1px', background: 'var(--color-rule)', margin: '1.5rem 0' }} />

          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', fontWeight: '600' }}>Configurar Ejecución</h3>

          {/* ── Panel genérico (14 módulos) ── */}
          {renderGenericPanel()}

          {/* ── Cleanup: categorías con safety badges ── */}
          {module === 'cleanup' && (
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Qué liberar:</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', width: 'auto' }}
                    onClick={() => {
                      const next = {};
                      availableCategories.forEach((c) => { if (c.safety === 'SAFE') next[c.key] = true; });
                      setSelectedCategories(next);
                    }}
                    disabled={isRunning}
                  >
                    Solo Seguras
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', width: 'auto' }}
                    onClick={() => setSelectedCategories({})}
                    disabled={isRunning}
                  >
                    Limpiar
                  </button>
                </div>
              </div>
              <div className="checkbox-list" style={{ maxHeight: '320px' }}>
                {availableCategories.map((cat) => (
                  <label key={cat.key} className="checkbox-item" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={selectedCategories[cat.key] || false}
                      onChange={() => setSelectedCategories((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                      disabled={isRunning}
                      style={{ marginTop: '3px' }}
                    />
                    <span className="checkbox-label" style={{ flex: 1 }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{cat.label}</span>
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px',
                          background: cat.safety === 'SAFE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: cat.safety === 'SAFE' ? '#10b981' : '#f59e0b',
                          border: `1px solid ${cat.safety === 'SAFE' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                          fontWeight: 600,
                        }}>
                          {cat.safety === 'SAFE' ? 'Seguro' : 'Precaución'}
                        </span>
                      </span>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-ink-3)', marginTop: '2px' }}>
                        {cat.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'cleanup' && selectedCategories.downloads && (
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

          {/* ── Startup: 4 listas separadas ── */}
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
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
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
                        <span className="checkbox-label" title={task.name}>
                          {task.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(disabledPrograms.length > 0 || disabledTasks.length > 0) && (
                <div className="disabled-items-section">
                  <div style={{ height: '1px', background: 'var(--color-rule)', margin: '1.5rem 0' }} />
                  <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: '600' }}>
                    Deshabilitados
                  </h3>
                  <p style={{ color: 'var(--color-ink-3)', fontSize: '0.8rem', marginBottom: '1rem' }}>
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
                              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
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
                            <span className="checkbox-label" title={task.name}>
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

          {/* ── Power: botones de plan ── */}
          {module === 'power' && powerPlans.length > 0 && (
            <div className="form-group">
              <label className="form-label">Cambiar plan de energía:</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                {powerPlans.map((plan) => (
                  <button
                    key={plan.guid}
                    className={`btn btn-sm${plan.active ? ' btn-primary' : ''}`}
                    onClick={() => !plan.active && switchToPlan(plan.guid)}
                    disabled={isRunning || plan.active}
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {plan.active ? '✓ ' : ''}{plan.name}{plan.active ? ' (activo)' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Network: bufferbloat toggle ── */}
          {module === 'network' && (
            <div className="form-group">
              <label className="form-label">Opciones del diagnóstico:</label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={bufferbloat}
                  onChange={() => setBufferbloat((v) => !v)}
                  disabled={isRunning}
                />
                <span className="checkbox-label">
                  Medir latencia bajo carga
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-warning)' }}>
                    Satura la conexión unos segundos a propósito. No lo corras
                    mientras jugás o estás en una llamada.
                  </span>
                </span>
              </label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginTop: 'var(--space-3)' }}>
                El diagnóstico tarda alrededor de un minuto: encadena ping
                sostenido, traceroute, MTU y comparación de servidores DNS.
              </p>
            </div>
          )}

          {/* ── Adblock: listas + botón quitar ── */}
          {module === 'adblock' && (
            <div className="form-group">
              <label className="form-label">Listas a usar:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Se descargan al aplicar. Windows va a pedir permiso de
                administrador para escribir el archivo hosts.
              </p>
              <div className="checkbox-list">
                {adblockSources.map((f, idx) => (
                  <label key={f.id} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedSources[idx] || false}
                      onChange={() => setSelectedSources(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={f.name}>
                      {f.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {f.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="btn btn-danger"
                style={{ width: '100%', marginTop: 'var(--space-4)' }}
                onClick={() => runAction({ adblockAction: 'remove' })}
                disabled={isRunning}
              >
                Quitar el bloqueo
              </button>
            </div>
          )}

          {/* ── RAM: 3 tiers con controles especiales ── */}
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
                <p style={{ fontSize: '0.7rem', color: 'var(--color-ink-3)', marginTop: '0.25rem' }}>
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
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                            PID: {proc.pid} — {proc.mb} MB
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {unknownProcesses.length > 0 && (
                <div className="form-group" style={{ marginTop: '1rem', borderTop: '1px solid var(--color-rule)', paddingTop: '1rem' }}>
                  <label className="form-label" style={{ color: 'var(--color-warning, #e0a32a)' }}>
                    Procesos no identificados:
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginTop: '0.25rem', marginBottom: '0.75rem' }}>
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
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                            PID: {proc.pid} — {proc.mb} MB
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {riskyProcesses.length > 0 && (
                <div className="form-group" style={{ marginTop: '1rem', borderTop: '1px solid var(--color-rule)', paddingTop: '1rem' }}>
                  <label className="form-label" style={{ color: 'var(--color-danger, #e05a5a)' }}>
                    No recomendado (editores/navegadores/sync/chat):
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginTop: '0.25rem' }}>
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
                    <span className="checkbox-label" style={{ color: 'var(--color-danger, #e05a5a)' }}>
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
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
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

          <div className="form-group" style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* La simulacion va primero y a propósito: es el camino por defecto
                para lo irreversible. */}
            <button
              className="btn btn-secondary"
              onClick={() => runAction({ dryRun: true })}
              disabled={isRunning}
            >
              Ver qué va a pasar (no toca nada)
            </button>
            <button className="btn btn-primary" onClick={() => runAction()} disabled={isRunning}>
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
