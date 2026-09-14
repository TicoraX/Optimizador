import { ICONS } from '../modules';

/** Icono de módulo o perfil. Decorativo: se oculta a lectores de pantalla. */
export function ModuleIcon({ path, moduleKey, size = 18, className, style }) {
  const d = path || (moduleKey ? ICONS[moduleKey] : null);
  if (!d) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
