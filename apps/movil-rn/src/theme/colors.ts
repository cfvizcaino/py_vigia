/** Paleta de la versión morada del Figma VIGÍA-DESIGN (página móvil 2015:16). */
export const colors = {
  background: '#090119',
  backgroundEnd: '#57038f',
  surface: 'rgba(255,255,255,0.10)',
  surfaceRaised: 'rgba(217,217,217,0.10)',
  accent: '#9d76f8',
  accentDeep: '#57038f',
  route: '#c4a8ff',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.80)',
  subtle: 'rgba(255,255,255,0.60)',
  icon: '#e3e3e3',
  border: 'rgba(255,255,255,0.28)',
  pill: '#d9d9d9',
  ink: '#090119',
  warning: '#ffd479',
  warningBackground: 'rgba(255,212,121,0.12)',
  danger: '#ff8a9a',
  success: '#7ee2b8',
} as const;

/** Degradados del Figma: fondo de pantalla, títulos, tarjeta seleccionada, barra inferior. */
export const gradients = {
  screen: ['#090119', '#57038f'] as const,
  title: ['#ffffff', 'rgba(157,118,248,0.8)'] as const,
  tileOn: ['rgba(157,118,248,0.8)', 'rgba(87,3,143,0.8)'] as const,
  loginButton: ['#57038f', '#090119'] as const,
  loginSheet: ['#57038f', 'rgba(157,118,248,0.8)', 'rgba(255,255,255,0.8)'] as const,
  tabBar: ['#793aa2', '#651ba5'] as const,
  routeCard: ['rgba(87,3,143,0.24)', 'rgba(157,118,248,0.8)'] as const,
  routeSide: ['rgba(9,1,25,0.51)', 'rgba(157,118,248,0.8)'] as const,
  sheet: ['rgba(87,3,143,0.19)', 'rgba(157,118,248,0.20)', 'rgba(255,255,255,0.19)'] as const,
  sourcePanel: ['rgba(255,255,255,0.35)', 'rgba(157,118,248,0.35)', 'rgba(87,3,143,0.44)'] as const,
  locationCard: ['rgba(217,217,217,0.20)', 'rgba(157,118,248,0.16)'] as const,
  dialog: ['#090119', '#57038f'] as const,
  logo: ['#cbb8ff', '#9d76f8', '#7d43e4'] as const,
};
