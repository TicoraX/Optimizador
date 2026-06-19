import React, { useEffect, useRef } from 'react';

export default function Terminal({ logs, isRunning, onAbort, progress }) {
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (logs.length === 0 && !isRunning) return null;

  const hasProgress = progress && progress.percentage != null;

  return (
    <div className="terminal-container glass-panel">
      <div className="terminal-header">
        <div className="terminal-title">
          <span className={`status-dot ${isRunning ? 'online' : ''}`}></span>
          <span>CONSOLE TERMINAL (POWERSHELL STREAM)</span>
        </div>
        {isRunning && onAbort && (
          <button
            className="btn btn-danger"
            style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.8rem' }}
            onClick={onAbort}
          >
            CANCELAR TAREA
          </button>
        )}
      </div>

      {/* Progress bar — only shown when backend emits progress events */}
      {hasProgress && (
        <div className="terminal-progress-wrap">
          <div className="terminal-progress-bar" style={{ width: `${progress.percentage}%` }} />
          <span className="terminal-progress-label">
            {progress.total
              ? `Paso ${progress.current} de ${progress.total} — ${progress.percentage}%`
              : `${progress.percentage}%`}
          </span>
        </div>
      )}

      <div className="terminal-body">
        {logs.map((log, index) => {
          let lineClass = 'terminal-line';
          if (log.type === 'error')  lineClass += ' error';
          if (log.type === 'info')   lineClass += ' info';
          if (log.type === 'system') lineClass += ' system';
          return (
            <div key={index} className={lineClass}>
              {log.text}
            </div>
          );
        })}
        {isRunning && (
          <div className="terminal-line system">
            [SISTEMA] Ejecutando comando... esperando respuesta del subproceso...
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
