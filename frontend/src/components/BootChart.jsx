import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

/**
 * Aislado en su propio archivo para poder cargarlo con React.lazy: recharts
 * pesa ~500 KB y este grafico solo se muestra si hay historial de arranque.
 *
 * Los colores salen de los tokens leidos del DOM, no hardcodeados: asi el
 * grafico sigue al tema claro/oscuro sin una segunda paleta.
 */
export default function BootChart({ data }) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--color-accent').trim();
  const rule = css.getPropertyValue('--color-rule').trim();
  const ink3 = css.getPropertyValue('--color-ink-3').trim();
  const paper2 = css.getPropertyValue('--color-paper-2').trim();

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid stroke={rule} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="fecha" stroke={ink3} fontSize={12} tickLine={false} axisLine={{ stroke: rule }} />
        <YAxis stroke={ink3} fontSize={12} tickLine={false} axisLine={false} unit="s" />
        <Tooltip
          contentStyle={{ background: paper2, border: `1px solid ${rule}`, borderRadius: 6 }}
          labelStyle={{ color: ink3 }}
          formatter={(v) => [`${v} s`, 'Arranque']}
        />
        <Line type="monotone" dataKey="tiempo" stroke={accent} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
