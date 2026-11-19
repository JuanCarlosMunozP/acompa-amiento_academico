// Tema del colegio. Colores provisionales: reemplazar por la identidad
// institucional (escudo/manual de marca) cuando esté definida.
export const colors = {
  primary: '#1F3A8A',
  primaryText: '#FFFFFF',
  /** Verde de la barra superior y del menú lateral (el resto de la interfaz sigue en azul). */
  navegacion: '#1B6B45',
  secondary: '#F5B301',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1A1D23',
  textMuted: '#5F6B7A',
  border: '#E1E5EA',
  error: '#C62828',
  success: '#2E7D32',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 6, md: 12, lg: 20 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 16, fontWeight: '500' },
  body: { fontSize: 14, fontWeight: '400' },
} as const;

export const institution = { name: 'Colegio', appName: 'Acompañamiento Académico' } as const;

export const theme = { colors, spacing, radius, typography, institution };
export type Theme = typeof theme;
