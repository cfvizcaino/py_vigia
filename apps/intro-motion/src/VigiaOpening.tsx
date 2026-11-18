import type {CSSProperties} from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// Apertura de la app: se muestra una sola vez, en el arranque en frío.
// v2: 5 s → 2,8 s, sin cuadros muertos al inicio, fases encadenadas y salida limpia:
// el último cuadro es solo el fondo de «Recibimiento W01», así la app pasa a la
// bienvenida sin salto (ver output/LEEME-apertura.md).
export const OPENING_FPS = 30;
export const OPENING_DURATION_IN_FRAMES = 84;

const COLORS = {
  canvas: '#090119',
  violetDeep: '#57038f',
  violet: '#9d76f8',
  route: '#c4a8ff',
  white: '#f7f3ff',
} as const;

// Hitos (cuadros a 30 fps). Se reutilizan en render:stills y en el guion del Figma.
export const BEATS = {
  network: [0, 22],
  pinDrop: 8,
  pinLand: 22,
  nodes: [22, 34],
  route: [30, 50],
  fill: [47, 56],
  ping: [52, 70],
  networkOut: [54, 68],
  logoOut: [72, 82],
} as const;

// Geometría de los cinco estados de apertura del Figma MOBILE (2015:16).
const NETWORK_PATHS = [
  'M 0 74 L 423 850',
  'M 0 23 L 417 780',
  'M 418 118 L -7 893',
  'M 423 80 L -7 865',
  'M -3 96 L 418 865',
  'M -9 112 L 430 917',
  'M -4 37 L 417 810',
  'M 0 412 L 412 412',
  'M 0 425 L 412 425',
] as const;

const NODES = [
  [199.5, 411.5],
  [221.5, 449.5],
  [234.5, 426.5],
  [221.5, 425.5],
  [213.5, 411.5],
  [258.5, 411.5],
  [221.5, 478.5],
  [191.5, 426.5],
  [178.5, 426.5],
  [205.5, 506.5],
  [154.5, 411.5],
] as const;

// Isotipo de apps/web/src/components/brand.tsx (nodo Figma 2001:3), empezando en el nodo del pin.
const LOGO_PATH =
  'M27 0L39.5 23L46.5 8L38.5 8L35 0L61 0L38.8 39.5L22 8L13.5 8L35 47L30.5 56L0 0L27 0Z';
const LOGO_SCALE = 1.6721311475; // 61 × 56 → 102 × 94, como «image 1» en el Figma
const LOGO_CENTER = [154.35 + 30.5 * LOGO_SCALE, 411.5 + 28 * LOGO_SCALE] as const;

const OUT = Easing.bezier(0.22, 1, 0.36, 1);
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

const ramp = (frame: number, start: number, end: number, easing = OUT) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

const pathStyle = (progress: number): CSSProperties => ({
  strokeDasharray: '1 1',
  strokeDashoffset: 1 - progress,
});

export const VigiaOpening = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const networkOpacity = 1 - ramp(frame, BEATS.networkOut[0], BEATS.networkOut[1], IN_OUT);
  const routeProgress = ramp(frame, BEATS.route[0], BEATS.route[1], IN_OUT);
  const logoFill = ramp(frame, BEATS.fill[0], BEATS.fill[1]);
  const logoOut = ramp(frame, BEATS.logoOut[0], BEATS.logoOut[1], IN_OUT);

  // El pin cae desde arriba y rebota una vez sobre el primer nodo.
  const pinFall = spring({
    frame: frame - BEATS.pinDrop,
    fps,
    config: {mass: 0.6, damping: 11, stiffness: 170},
  });
  const pinY = interpolate(pinFall, [0, 1], [300, 411.5]);
  const pinOpacity = ramp(frame, BEATS.pinDrop - 1, BEATS.pinDrop + 4) * (1 - ramp(frame, BEATS.route[0] - 2, BEATS.route[0] + 5));
  const pinScale = interpolate(ramp(frame, BEATS.pinDrop, BEATS.pinDrop + 8), [0, 1], [0.8, 1.45]);

  // Al llenarse, el logo «respira» una vez y luego sale con un leve encogimiento.
  const settle = spring({frame: frame - BEATS.fill[0], fps, config: {mass: 0.5, damping: 9, stiffness: 160}});
  const logoScale = interpolate(settle, [0, 1], [0.94, 1]) * interpolate(logoOut, [0, 1], [1, 0.92]);
  const glow = interpolate(frame, [BEATS.fill[0], BEATS.fill[1] + 4, BEATS.logoOut[0]], [0, 1, 0.7], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const ping = ramp(frame, BEATS.ping[0], BEATS.ping[1]);

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 51% 46%, rgba(119,56,192,.17) 0%, rgba(9,1,25,0) 29%), linear-gradient(180deg, #090119 0%, #190126 38%, #57038f 100%)',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 412 917"
        width="100%"
        height="100%"
        role="img"
        aria-label="El símbolo de VIGÍA se construye como una ruta entre nodos"
      >
        <defs>
          <filter id="logo-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="logo-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#cbb8ff" />
            <stop offset="0.48" stopColor={COLORS.violet} />
            <stop offset="1" stopColor="#7d43e4" />
          </linearGradient>
          <radialGradient id="bloom">
            <stop offset="0" stopColor={COLORS.violet} stopOpacity="0.5" />
            <stop offset="1" stopColor={COLORS.violet} stopOpacity="0" />
          </radialGradient>
        </defs>

        <g opacity={networkOpacity}>
          {NETWORK_PATHS.map((d, index) => {
            // Las líneas arrancan en el cuadro 0 y en pares, así no hay segundos vacíos.
            const start = Math.floor(index / 2) * 2.5;
            const progress = ramp(frame, start, start + 14);
            return (
              <path
                key={d}
                d={d}
                pathLength={1}
                fill="none"
                stroke={COLORS.route}
                strokeWidth={0.58}
                strokeLinecap="round"
                opacity={0.62}
                style={pathStyle(progress)}
              />
            );
          })}
        </g>

        <circle
          cx={LOGO_CENTER[0]}
          cy={LOGO_CENTER[1]}
          r={110}
          fill="url(#bloom)"
          opacity={glow * (1 - logoOut)}
        />

        <g transform={`translate(199.5 ${pinY}) scale(${pinScale})`} opacity={pinOpacity}>
          <path
            d="M0 0C-2.3-4.2-9-10.3-9-16a9 9 0 1 1 18 0C9-10.3 2.3-4.2 0 0Z"
            fill={COLORS.canvas}
            stroke={COLORS.route}
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <circle cy="-16" r="3" fill={COLORS.violet} />
          <circle cy="-16" r="1.25" fill={COLORS.white} />
        </g>

        {NODES.map(([cx, cy], index) => {
          const nodeStart = index === 0 ? BEATS.pinLand : BEATS.nodes[0] + 2 + (index - 1) * 1.1;
          const scale = spring({
            frame: frame - nodeStart,
            fps,
            config: {mass: 0.5, damping: 12, stiffness: 220},
          });
          const opacity = ramp(frame, nodeStart - 1, nodeStart + 5);
          const ringOpacity = opacity * (1 - ramp(frame, nodeStart + 5, nodeStart + 13));
          return (
            <g
              key={`${cx}-${cy}`}
              transform={`translate(${cx} ${cy}) scale(${Math.min(1, Math.max(0, scale))})`}
              opacity={opacity * networkOpacity}
            >
              <circle r="4.5" fill="none" stroke={COLORS.route} strokeWidth="0.7" opacity={ringOpacity * 0.72} />
              <circle r="1.55" fill={COLORS.white} />
            </g>
          );
        })}

        {/* Onda del aterrizaje del pin */}
        <circle
          cx="199.5"
          cy="411.5"
          r={interpolate(frame, [BEATS.pinLand, BEATS.pinLand + 12], [2, 18], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
          fill="none"
          stroke={COLORS.route}
          strokeWidth="0.7"
          opacity={interpolate(frame, [BEATS.pinLand - 1, BEATS.pinLand + 4, BEATS.pinLand + 14], [0, 0.65, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
        />

        <g
          transform={`translate(${LOGO_CENTER[0]} ${LOGO_CENTER[1]}) scale(${logoScale}) translate(${-LOGO_CENTER[0]} ${-LOGO_CENTER[1]})`}
          opacity={ramp(frame, BEATS.route[0] - 1, BEATS.route[0] + 2) * (1 - logoOut)}
        >
          <g transform={`translate(154.35 411.5) scale(${LOGO_SCALE})`} filter="url(#logo-glow)">
            <path
              d={LOGO_PATH}
              pathLength={1}
              fill="none"
              stroke={COLORS.route}
              strokeWidth={0.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={1 - logoFill * 0.6}
              style={pathStyle(routeProgress)}
            />
            <path d={LOGO_PATH} fill="url(#logo-fill)" opacity={logoFill} />
            <path d={LOGO_PATH} fill="none" stroke={COLORS.white} strokeWidth={0.2} opacity={logoFill * 0.45} />
          </g>
        </g>

        {/* Pulso de vigilancia: el radio de búsqueda de la consulta, una sola vez */}
        <circle
          cx={LOGO_CENTER[0]}
          cy={LOGO_CENTER[1]}
          r={interpolate(ping, [0, 1], [52, 150])}
          fill="none"
          stroke={COLORS.violet}
          strokeWidth="1.2"
          strokeDasharray="5 4"
          opacity={interpolate(ping, [0, 0.15, 1], [0, 0.7, 0])}
        />
      </svg>
    </AbsoluteFill>
  );
};
