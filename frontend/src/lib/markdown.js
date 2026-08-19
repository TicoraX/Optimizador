import { Marked } from 'marked';

// El reporte se arma con nombres de procesos, apps instaladas, servicios y rutas
// del sistema, o sea contenido que controla cualquier binario de la maquina. Se
// inyecta con dangerouslySetInnerHTML, asi que el HTML crudo del Markdown se
// ejecutaba: una app llamada `<img src=x onerror=...>` corria JS con acceso al
// origin del backend.
//
// Los reportes nunca llevan HTML legitimo, asi que en vez de sumar un
// sanitizador se desactiva el HTML por completo y se restringe el protocolo de
// los links. Superficie chica y auditable, sin dependencia nueva.

export const escapeHtml = (s) => String(s).replace(
  /[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
);

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

const marked = new Marked({
  renderer: {
    // HTML crudo (bloque e inline) se escapa en vez de pasar al DOM.
    html: (t) => escapeHtml(t?.text ?? t?.raw ?? t),
    // Bloquea javascript:, data: y demas esquemas ejecutables.
    link(t) {
      const href = String(t?.href ?? '');
      if (!SAFE_HREF.test(href)) return escapeHtml(t?.text ?? '');
      return `<a href="${escapeHtml(href)}" rel="noreferrer">${this.parser.parseInline(t.tokens)}</a>`;
    },
    image: (t) => escapeHtml(t?.text ?? t?.raw ?? ''),
  },
});

/** Convierte el Markdown de un reporte en HTML seguro para inyectar. */
export function renderReport(content) {
  return marked.parse(content || '');
}
