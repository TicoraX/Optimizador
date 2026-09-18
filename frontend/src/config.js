const isTauri = typeof window !== 'undefined' && (
  Boolean(window.__TAURI_INTERNALS__) ||
  window.location.hostname === 'tauri.localhost' ||
  window.location.protocol === 'tauri:'
);

export const API_BASE = isTauri ? 'http://127.0.0.1:3001/api' : '/api';
