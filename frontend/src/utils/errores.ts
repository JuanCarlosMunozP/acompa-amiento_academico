/** Mensaje legible de un error de la API (`{error: {message}}`), o el texto por defecto. */
export function mensajeDe(e: unknown, porDefecto: string): string {
  return (e as { error?: { message?: string } })?.error?.message ?? porDefecto;
}

/** Errores por campo que devuelve la API: `{error: {details: {campo: [mensajes]}}}`. */
export function erroresDeCampos(e: unknown): Record<string, string> {
  const details = (e as { error?: { details?: unknown } })?.error?.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return Object.fromEntries(
    Object.entries(details as Record<string, unknown>).map(([campo, valor]) => [
      campo,
      Array.isArray(valor) ? valor.join(' ') : String(valor),
    ]),
  );
}
