import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import Terminal from './Terminal';
import LogViewer from './LogViewer';
import { API_BASE } from '../config';
import { renderReport } from '../lib/markdown';

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

  // Configuration States
  const [downloadsAgeDays, setDownloadsAgeDays] = useState(30);
  const [availableCategories, setAvailableCategories] = useState(CLEAN_CATEGORIES);
  // Nada tildado por defecto: borrar es irreversible, el usuario elige.
  const [selectedCategories, setSelectedCategories] = useState({});
  const [availablePrograms, setAvailablePrograms] = useState([]);
  const [selectedPrograms, setSelectedPrograms] = useState({});
  const [availableTasks, setAvailableTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState({});
  const [disabledPrograms, setDisabledPrograms] = useState([]);
  const [selectedEnablePrograms, setSelectedEnablePrograms] = useState({});
  const [disabledTasks, setDisabledTasks] = useState([]);
  const [selectedEnableTasks, setSelectedEnableTasks] = useState({});

  // Services Optimizer States
  const [availableServices, setAvailableServices] = useState([]);
  const [selectedServices, setSelectedServices] = useState({});

  // Power Optimizer States
  const [powerPlans, setPowerPlans] = useState([]);

  // App Manager States
  const [availableApps, setAvailableApps] = useState([]);
  const [selectedApps, setSelectedApps] = useState({});

  // Privacy States
  const [privacySettings, setPrivacySettings] = useState([]);
  const [selectedPrivacy, setSelectedPrivacy] = useState({});

  // Gaming & GPU States
  const [gamingSettings, setGamingSettings] = useState([]);
  const [selectedGaming, setSelectedGaming] = useState({});

  // System Integrity States
  const [integrityItems, setIntegrityItems] = useState([]);
  const [selectedIntegrity, setSelectedIntegrity] = useState({});

  // Context Menu States
  const [contextMenuHandlers, setContextMenuHandlers] = useState([]);
  const [selectedContextMenu, setSelectedContextMenu] = useState({});

  // OEM Debloat States
  const [oemServices, setOemServices] = useState([]);
  const [selectedOem, setSelectedOem] = useState({});
  const [oemMode, setOemMode] = useState('demand');

  // Timers States
  const [timerSettings, setTimerSettings] = useState([]);
  const [selectedTimers, setSelectedTimers] = useState({});

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
  const [adblockSources, setAdblockSources] = useState([]);
  const [selectedSources, setSelectedSources] = useState({});
  const [bufferbloat, setBufferbloat] = useState(false);

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

      // Los elementos seleccionables vienen ya estructurados del backend.
      // Antes se reconstruian con 5 parsers de regex sobre el Markdown del
      // reporte: cambiar la redaccion de una linea rompia los checkboxes en
      // silencio, y el indice del texto no siempre era el que usaba la accion.
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

  // Vacia las listas del modulo activo. Este componente NO se remonta al
  // cambiar de :module (misma Route), asi que sin esto un fetch fallido dejaba
  // en pie la seleccion del escaneo anterior y el usuario podia ejecutar una
  // accion sobre elementos que ya no existen.
  const clearItems = () => {
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
    } else if (module === 'services') {
      setAvailableServices([]); setSelectedServices({});
    } else if (module === 'apps') {
      setAvailableApps([]); setSelectedApps({});
    } else if (module === 'privacy') {
      setPrivacySettings([]); setSelectedPrivacy({});
    } else if (module === 'gaming') {
      setGamingSettings([]); setSelectedGaming({});
    } else if (module === 'integrity') {
      setIntegrityItems([]); setSelectedIntegrity({});
    } else if (module === 'contextmenu') {
      setContextMenuHandlers([]); setSelectedContextMenu({});
    } else if (module === 'oemdebloat') {
      setOemServices([]); setSelectedOem({});
    } else if (module === 'timers') {
      setTimerSettings([]); setSelectedTimers({});
    } else if (module === 'power') {
      setPowerPlans([]);
    }
  };

  // Carga los elementos seleccionables del ultimo escaneo.
  const loadItems = async () => {
    const res = await fetch(`${API_BASE}/reports/${module}/items`);
    // 404 es legitimo: el modulo no tiene seleccion (network, updates)
    // o todavia no se escaneo. Igual hay que limpiar: es la unica forma de no
    // quedarse con la lista del modulo anterior.
    if (!res.ok) { clearItems(); return; }
    const { items } = await res.json();

    const noneChecked = (list) => Object.fromEntries(list.map((_, i) => [i, false]));

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
    } else if (module === 'services') {
      setAvailableServices(items);
      setSelectedServices(noneChecked(items));
    } else if (module === 'apps') {
      setAvailableApps(items);
      setSelectedApps(noneChecked(items));
    } else if (module === 'privacy') {
      setPrivacySettings(items);
      setSelectedPrivacy(noneChecked(items));
    } else if (module === 'gaming') {
      setGamingSettings(items || []);
      setSelectedGaming(Object.fromEntries((items || []).map((s, i) => [i, !s.optimized])));
    } else if (module === 'integrity') {
      setIntegrityItems(items || []);
      setSelectedIntegrity(Object.fromEntries((items || []).map((it, i) => [i, it.recommended !== false])));
    } else if (module === 'contextmenu') {
      setContextMenuHandlers(items || []);
      setSelectedContextMenu(Object.fromEntries((items || []).map((it, i) => [i, it.recommendedDisable === true])));
    } else if (module === 'oemdebloat') {
      setOemServices(items || []);
      setSelectedOem(Object.fromEntries((items || []).map((it, i) => [i, it.recommendedManual === true])));
    } else if (module === 'timers') {
      setTimerSettings(items || []);
      setSelectedTimers(Object.fromEntries((items || []).map((it, i) => [i, !it.isOptimized])));
    } else if (module === 'power') {
      setPowerPlans(items);
    } else if (module === 'adblock') {
      setAdblockSources(items.fuentes || []);
      // Todas marcadas por defecto: es lo que quiere quien entra a este modulo,
      // y son listas curadas, no una seleccion peligrosa.
      setSelectedSources(Object.fromEntries((items.fuentes || []).map((_, i) => [i, true])));
    }
  };

  // `switchingPlan` se seteaba y se limpiaba en el mismo tick, asi que el
  // `disabled` que dependia de el nunca se activaba. Estado muerto, eliminado.
  const switchToPlan = (planGuid) => {
    triggerExecution('/action/power', { planGuid });
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

  const runScan = () => {
    const body = {};
    if (module === 'cleanup') body.downloadsAgeDays = downloadsAgeDays;
    if (module === 'network') body.bufferbloat = bufferbloat;
    if (module === 'ram') {
      body.cleanMode = cleanMode;
      // Mismo umbral que se manda en runAction() - el scan y la accion deben
      // usar el mismo valor, o los indices marcados en el reporte podrian
      // referirse a un proceso distinto al ejecutar la accion.
      body.minRamMB = minRamMB;
    }
    triggerExecution(`/scan/${module}`, body);
  };

  // dryRun corre la accion completa sin tocar nada y reporta que HARIA. Es la
  // unica red de contencion para lo irreversible (borrar archivos, desinstalar).
  const runAction = ({ dryRun = false, adblockAction } = {}) => {
    const body = dryRun ? { dryRun: true } : {};
    if (module === 'adblock') {
      // Dos acciones opuestas en el mismo modulo, asi que cual se ejecuta viene
      // del boton y no de un estado: no hay forma de apretar "quitar" y que se
      // mande "aplicar" porque quedo algo viejo en el estado.
      body.adblockAction = adblockAction || 'apply';
      body.sources = adblockSources
        .filter((_, i) => selectedSources[i])
        .map((f) => f.id);
    }
    if (module === 'cleanup') {
      body.downloadsAgeDays = downloadsAgeDays;
      body.cleanCategories = CLEAN_CATEGORIES
        .filter((c) => selectedCategories[c.key])
        .map((c) => c.key);
    } else if (module === 'startup') {
      // Por identificador, no por indice: si entre el escaneo y este clic se
      // agrega o quita una entrada de inicio, el indice N pasa a apuntar a otra
      // y se deshabilita lo que no era.
      const pickedIds = (selection, list) => Object.keys(selection)
        .filter(k => selection[k])
        .map(k => list[parseInt(k)]?.id)
        .filter(Boolean);

      body.programs = pickedIds(selectedPrograms, availablePrograms);
      body.tasks = pickedIds(selectedTasks, availableTasks);
      body.enablePrograms = pickedIds(selectedEnablePrograms, disabledPrograms);
      body.enableTasks = pickedIds(selectedEnableTasks, disabledTasks);
    } else if (module === 'services') {
      // Por nombre, no por indice: el indice del reporte no coincidia con el
      // orden que usaba la accion y se deshabilitaba el servicio equivocado.
      const names = Object.keys(selectedServices)
        .filter(k => selectedServices[k])
        .map(k => availableServices[parseInt(k)]?.name)
        .filter(Boolean);
      body.services = names;
    } else if (module === 'apps') {
      const ids = Object.keys(selectedApps)
        .filter(k => selectedApps[k])
        .map(k => availableApps[parseInt(k)]?.id)
        .filter(Boolean);
      body.apps = ids.join(',');
    } else if (module === 'privacy') {
      const checked = Object.keys(selectedPrivacy)
        .filter(k => selectedPrivacy[k])
        .map(k => parseInt(k) + 1);
      body.privacy = checked.length === 0 ? '' : checked.join(',');
    } else if (module === 'gaming') {
      const checked = Object.keys(selectedGaming)
        .filter(k => selectedGaming[k])
        .map(k => gamingSettings[parseInt(k)]?.id)
        .filter(Boolean);
      body.settings = checked.join(',');
    } else if (module === 'integrity') {
      const checked = Object.keys(selectedIntegrity)
        .filter(k => selectedIntegrity[k])
        .map(k => integrityItems[parseInt(k)]?.action)
        .filter(Boolean);
      body.actions = checked.join(',');
    } else if (module === 'contextmenu') {
      const checked = Object.keys(selectedContextMenu)
        .filter(k => selectedContextMenu[k])
        .map(k => contextMenuHandlers[parseInt(k)]?.regPath)
        .filter(Boolean);
      body.handlers = checked.join(',');
    } else if (module === 'oemdebloat') {
      const checked = Object.keys(selectedOem)
        .filter(k => selectedOem[k])
        .map(k => oemServices[parseInt(k)]?.serviceName)
        .filter(Boolean);
      body.services = checked.join(',');
      body.mode = oemMode;
    } else if (module === 'timers') {
      const checked = Object.keys(selectedTimers)
        .filter(k => selectedTimers[k])
        .map(k => timerSettings[parseInt(k)]?.id)
        .filter(Boolean);
      body.settings = checked.join(',');
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
        // Sin mensaje: onclose corre tambien despues de un 'done' limpio, y
        // anunciar "conexion cerrada por el servidor" ahi parecia un error al
        // final de toda ejecucion exitosa.
        
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
      case 'network': return 'Red y Conectividad';
      case 'services': return 'Optimización de Servicios';
      case 'power': return 'Plan de Energía';
      case 'apps': return 'Administrador de Aplicaciones';
      case 'privacy': return 'Privacidad';
      case 'gaming': return 'Optimización Gaming & GPU';
      case 'integrity': return 'Integridad y Salud del Sistema';
      case 'contextmenu': return 'Menú Contextual (Clic Derecho)';
      case 'oemdebloat': return 'Debloat de Fabricantes (OEM)';
      case 'timers': return 'Temporizadores y Latencia de Reloj BCD';
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
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-warning)', marginBottom: '1rem'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <h3>No hay reporte disponible</h3>
              <p style={{ color: 'var(--color-ink-3)', marginTop: '0.5rem' }}>{error}</p>
            </div>
          ) : (
            <>
              {report?.content && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-ink-3)', padding: '0 0 1rem 0', lineHeight: '1.4', borderBottom: '1px solid var(--color-rule)', marginBottom: '1rem' }}>
                  {module === 'updates' && 'Busca actualizaciones pendientes de winget, pip, npm y Chocolatey. No instala nada sin tu confirmación.'}
                  {module === 'cleanup' && 'Mide espacio recuperable en archivos temporales, caché de navegadores, descargas antiguas y papelera de reciclaje.'}
                  {module === 'startup' && 'Analiza programas, servicios y tareas programadas que se inician con tu sesión de Windows. Todo es reversible.'}
                  {module === 'ram' && 'Escanea procesos por consumo de RAM y clasifica cada uno en 4 niveles de riesgo (crítico, riesgoso, seguro, desconocido). Permite liberar memoria de forma selectiva.'}
                  {module === 'network' && 'Diagnostica dónde se agrega la latencia: jitter y pérdida sostenidos, latencia por salto hasta el destino, MTU, ahorro de energía del adaptador y comparación de servidores DNS. No baja el ping: eso requiere cambiar la ruta y no se puede hacer localmente.'}
                  {module === 'services' && 'Lista servicios con inicio automático separando Microsoft de terceros por ruta de archivo. Permite detener y deshabilitar servicios de terceros que no necesites.'}
                  {module === 'power' && 'Muestra el plan de energía activo con su descripción, batería y consumo estimado en watts. Permite cambiar de plan al instante.'}
                  {module === 'apps' && 'Lista aplicaciones instaladas vía winget con ID, versión y origen. Desinstala múltiples apps de forma silenciosa.'}
                  {module === 'privacy' && 'Revisa 8 ajustes de privacidad de Windows: telemetría, Cortana, ID publicitario, ubicación, cámara, micrófono y más. Los protege con un clic.'}
                  {module === 'gaming' && 'Acelera el paso de frames, reduce la latencia de CPU-a-GPU (HAGS) y desactiva grabaciones en segundo plano para optimizar juegos.'}
                  {module === 'integrity' && 'Verifica la salud del almacén de componentes (DISM), audita archivos protegidos (SFC) y limpia componentes obsoletos de WinSxS para recuperar espacio.'}
                  {module === 'contextmenu' && 'Audita y deshabilita extensiones de terceros en el menú de clic derecho del Explorador de Windows para acelerar su apertura.'}
                  {module === 'oemdebloat' && 'Identifica y optimiza servicios pesados de telemetría de fabricantes (Dell, HP, Lenovo, ASUS, Razer, Corsair) cambiándolos a inicio manual o desactivándolos.'}
                  {module === 'timers' && 'Ajusta parámetros de reloj de bajo nivel (Dynamic Ticking, HPET, TSC) en el almacén de arranque de Windows (BCD) para reducir el micro-stuttering.'}
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

          <div style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', padding: '0 0 0.75rem 0', lineHeight: '1.4' }}>
            {module === 'updates' && 'Busca actualizaciones de winget, pip, npm y Chocolatey. No instala nada sin tu confirmación.'}
            {module === 'cleanup' && 'Mide espacio recuperable en temporales, caché de navegadores, descargas y papelera. Solo lectura.'}
            {module === 'startup' && 'Analiza programas, servicios y tareas que se inician con tu sesión. Deshabilitar es reversible.'}
            {module === 'ram' && 'Escanea procesos por consumo de RAM, los clasifica por riesgo (seguro/riesgoso/crítico) y te permite liberar memoria de forma selectiva.'}
            {module === 'network' && 'Mide jitter, pérdida, latencia por salto, MTU y DNS. La acción solo limpia la caché DNS: no reduce la latencia.'}
            {module === 'services' && 'Lista servicios con inicio automático, separa MS de terceros. Permite detener y deshabilitar servicios que no necesites.'}
            {module === 'power' && 'Muestra el plan de energía activo, estado de batería y consumo estimado. Permite cambiar de plan al instante.'}
            {module === 'apps' && 'Lista aplicaciones instaladas vía winget y permite desinstalar varias a la vez de forma silenciosa.'}
            {module === 'privacy' && 'Revisa 8 ajustes de privacidad (telemetría, Cortana, ubicación, etc.) y los protege con un clic.'}
          </div>

          <div style={{ height: '1px', background: 'var(--color-rule)', margin: '1.5rem 0' }} />

          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', fontWeight: '600' }}>Configurar Ejecución</h3>

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

          {module === 'services' && availableServices.length > 0 && (
            <div className="form-group">
              <label className="form-label">Servicios de terceros a deshabilitar:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Se detendrá el servicio y se cambiará su inicio a "Deshabilitado".
              </p>
              <div className="checkbox-list">
                {availableServices.map((svc, idx) => (
                  <label key={idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedServices[idx] || false}
                      onChange={() => setSelectedServices(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={svc.name}>
                      {svc.displayName || svc.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {svc.name} — {svc.status}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
                    {/* `plan.desc` no existia: el parser producia solo
                        index/name/active, asi que el subtitulo salia vacio. */}
                    {plan.active ? '✓ ' : ''}{plan.name}{plan.active ? ' (activo)' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {module === 'apps' && availableApps.length > 0 && (
            <div className="form-group">
              <label className="form-label">Aplicaciones a desinstalar:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Se desinstalarán las aplicaciones seleccionadas via winget.
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {availableApps.map((app, idx) => (
                  <label key={idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedApps[idx] || false}
                      onChange={() => setSelectedApps(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={app.name}>
                      {app.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {app.id} — {app.version}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'privacy' && privacySettings.length > 0 && (
            <div className="form-group">
              <label className="form-label">Ajustes a proteger:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Se aplicará la configuración recomendada de privacidad a los ajustes seleccionados.
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {privacySettings.map((item, idx) => (
                  <label key={idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedPrivacy[idx] || false}
                      onChange={() => setSelectedPrivacy(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={item.name}>
                      {item.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {item.status}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'gaming' && gamingSettings.length > 0 && (
            <div className="form-group">
              <label className="form-label">Ajustes a optimizar:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Seleccioná las optimizaciones de latencia y aceleración gráfica a aplicar:
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {gamingSettings.map((item, idx) => (
                  <label key={item.id || idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedGaming[idx] || false}
                      onChange={() => setSelectedGaming(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={item.name}>
                      {item.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: item.optimized ? 'var(--color-success)' : 'var(--color-warning)' }}>
                        {item.optimized ? '✓ Ya optimizado' : `Pendiente · ${item.currentLabel}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'integrity' && integrityItems.length > 0 && (
            <div className="form-group">
              <label className="form-label">Acciones de mantenimiento:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Seleccioná las tareas de reparación o limpieza de WinSxS a ejecutar:
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {integrityItems.map((item, idx) => (
                  <label key={item.id || idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedIntegrity[idx] || false}
                      onChange={() => setSelectedIntegrity(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={item.name}>
                      {item.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {item.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'contextmenu' && contextMenuHandlers.length > 0 && (
            <div className="form-group">
              <label className="form-label">Extensiones a deshabilitar:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Seleccioná las extensiones de terceros que no usás para acelerar el menú contextual:
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {contextMenuHandlers
                  .filter((item) => !item.isSystem)
                  .map((item, idx) => (
                    <label key={item.id || idx} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedContextMenu[idx] || false}
                        onChange={() => setSelectedContextMenu(prev => ({ ...prev, [idx]: !prev[idx] }))}
                        disabled={isRunning}
                      />
                      <span className="checkbox-label" title={item.name}>
                        {item.name}
                        <span style={{ display: 'block', fontSize: '0.7rem', color: item.isBlocked ? 'var(--color-warning)' : 'var(--color-ink-3)' }}>
                          {item.location} · {item.isBlocked ? 'Ya desactivado' : 'Activo'}
                        </span>
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          {module === 'oemdebloat' && oemServices.length > 0 && (
            <div className="form-group">
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

              <label className="form-label">Servicios OEM detectados:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Seleccioná los servicios a configurar en inicio {oemMode === 'demand' ? 'Manual' : 'Deshabilitado'}:
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {oemServices.map((item, idx) => (
                  <label key={item.id || idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedOem[idx] || false}
                      onChange={() => setSelectedOem(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={item.name}>
                      <strong style={{ color: 'var(--color-brand)' }}>[{item.oem}]</strong> {item.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-ink-3)' }}>
                        {item.desc} · Actual: {item.startMode}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {module === 'timers' && timerSettings.length > 0 && (
            <div className="form-group">
              <label className="form-label">Ajustes BCD de temporizador:</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-ink-3)', marginBottom: '0.75rem' }}>
                Seleccioná los parámetros de reloj a optimizar en el arranque de Windows:
              </p>
              <div className="checkbox-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {timerSettings.map((item, idx) => (
                  <label key={item.id || idx} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedTimers[idx] || false}
                      onChange={() => setSelectedTimers(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      disabled={isRunning}
                    />
                    <span className="checkbox-label" title={item.name}>
                      {item.name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: item.isOptimized ? 'var(--color-success)' : 'var(--color-warning)' }}>
                        {item.desc} (Actual: {item.currentValue})
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
