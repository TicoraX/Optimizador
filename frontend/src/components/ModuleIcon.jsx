/** Icono de modulo. Decorativo: se oculta a lectores de pantalla. */
export function ModuleIcon({ path, size = 18 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
