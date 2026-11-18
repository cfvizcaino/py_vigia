import { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { Backdrop } from './ui';

/**
 * Apertura de la app (Figma «A0 · Apertura», apps/intro-motion/src/VigiaOpening.tsx).
 * Se dibuja con SVG y Reanimated en vez de un video: unos KB, nítida en cualquier pantalla.
 * 2,8 s a 30 «cuadros» por segundo; un toque la salta; con «reducir movimiento» no se muestra.
 */
const FRAMES = 84;
const DURATION_MS = 2800;

const NETWORK: [number, number, number, number][] = [
  [0, 74, 423, 850], [0, 23, 417, 780], [418, 118, -7, 893], [423, 80, -7, 865], [-3, 96, 418, 865],
  [-9, 112, 430, 917], [-4, 37, 417, 810], [0, 412, 412, 412], [0, 425, 412, 425],
];
const NODES: [number, number][] = [
  [199.5, 411.5], [221.5, 449.5], [234.5, 426.5], [221.5, 425.5], [213.5, 411.5], [258.5, 411.5],
  [221.5, 478.5], [191.5, 426.5], [178.5, 426.5], [205.5, 506.5], [154.5, 411.5],
];
const LOGO = 'M27 0L39.5 23L46.5 8L38.5 8L35 0L61 0L38.8 39.5L22 8L13.5 8L35 47L30.5 56L0 0L27 0Z';
const LOGO_POINTS = LOGO.match(/-?[\d.]+/g)!.map(Number);
const LOGO_LENGTH = (() => {
  let total = 0;
  for (let i = 2; i < LOGO_POINTS.length; i += 2) {
    total += Math.hypot(LOGO_POINTS[i]! - LOGO_POINTS[i - 2]!, LOGO_POINTS[i + 1]! - LOGO_POINTS[i - 1]!);
  }
  return total;
})();
const LOGO_SCALE = 1.6721311475;
const LOGO_CX = 154.35 + 30.5 * LOGO_SCALE;
const LOGO_CY = 411.5 + 28 * LOGO_SCALE;
const PIN = 'M0 0C-2.3-4.2-9-10.3-9-16a9 9 0 1 1 18 0C9-10.3 2.3-4.2 0 0Z';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

function ramp(frame: number, start: number, end: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  return 1 - Math.pow(1 - t, 3);
}

function rampInOut(frame: number, start: number, end: number) {
  'worklet';
  const t = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function networkOpacity(frame: number) {
  'worklet';
  return 1 - rampInOut(frame, 54, 68);
}

function NetworkLine({ frame, line, index }: { frame: SharedValue<number>; line: [number, number, number, number]; index: number }) {
  const length = Math.hypot(line[2] - line[0], line[3] - line[1]);
  const start = Math.floor(index / 2) * 2.5;
  const props = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - ramp(frame.value, start, start + 14)),
    strokeOpacity: 0.62 * networkOpacity(frame.value),
  }));
  return (
    <AnimatedPath
      animatedProps={props}
      d={`M${line[0]} ${line[1]}L${line[2]} ${line[3]}`}
      stroke="#c4a8ff"
      strokeDasharray={[length, length]}
      strokeLinecap="round"
      strokeWidth={0.58}
    />
  );
}

function Node({ frame, node, index }: { frame: SharedValue<number>; node: [number, number]; index: number }) {
  const start = index === 0 ? 22 : 24 + (index - 1) * 1.1;
  const dot = useAnimatedProps(() => ({
    r: 1.55 * ramp(frame.value, start, start + 5),
    fillOpacity: networkOpacity(frame.value),
  }));
  const ring = useAnimatedProps(() => {
    const shown = ramp(frame.value, start - 1, start + 5);
    return { r: 4.5 * shown, strokeOpacity: 0.72 * shown * (1 - ramp(frame.value, start + 5, start + 13)) * networkOpacity(frame.value) };
  });
  return (
    <>
      <AnimatedCircle animatedProps={ring} cx={node[0]} cy={node[1]} fill="none" stroke="#c4a8ff" strokeWidth={0.7} />
      <AnimatedCircle animatedProps={dot} cx={node[0]} cy={node[1]} fill="#f7f3ff" />
    </>
  );
}

export function Opening({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const frame = useSharedValue(0);
  // Mismo encuadre que el video: el lienzo de 412 × 917 cubre la pantalla.
  const scale = Math.max(width / 412, height / 917);
  const offsetX = (width - 412 * scale) / 2;
  const offsetY = (height - 917 * scale) / 2;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        onDone();
        return;
      }
      frame.value = withTiming(FRAMES, { duration: DURATION_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [frame, onDone]);

  const logoGroup = useAnimatedProps(() => ({ opacity: 1 - rampInOut(frame.value, 72, 82) }));
  const logoTrace = useAnimatedProps(() => ({
    strokeDashoffset: LOGO_LENGTH * (1 - rampInOut(frame.value, 30, 50)),
    strokeOpacity: frame.value < 29 ? 0 : 1 - 0.6 * ramp(frame.value, 47, 56),
  }));
  const logoFill = useAnimatedProps(() => ({ fillOpacity: ramp(frame.value, 47, 56) }));
  const bloom = useAnimatedProps(() => {
    const f = frame.value;
    const glow = f < 47 ? 0 : f < 60 ? (f - 47) / 13 : 1 - 0.3 * Math.min(1, (f - 60) / 12);
    return { opacity: glow * (1 - rampInOut(f, 72, 82)) };
  });
  const landing = useAnimatedProps(() => {
    const f = frame.value;
    return { r: 2 + 16 * Math.min(1, Math.max(0, (f - 22) / 12)), strokeOpacity: f < 21 || f > 36 ? 0 : 0.65 * (1 - (f - 22) / 14) };
  });
  const ping = useAnimatedProps(() => {
    const p = ramp(frame.value, 52, 70);
    return { r: 52 + 98 * p, strokeOpacity: frame.value < 52 ? 0 : p < 0.15 ? (p / 0.15) * 0.7 : (0.7 * (1 - p)) / 0.85 };
  });
  const pinStyle = useAnimatedStyle(() => {
    const f = frame.value;
    const fall = ramp(f, 8, 22);
    const y = 300 + 111.5 * fall;
    const bounce = f > 22 && f < 30 ? Math.sin(((f - 22) / 8) * Math.PI) * -6 : 0;
    const s = 0.8 + 0.65 * ramp(f, 8, 16);
    return {
      opacity: ramp(f, 7, 12) * (1 - ramp(f, 28, 35)),
      transform: [
        { translateX: offsetX + 199.5 * scale - 14 },
        { translateY: offsetY + (y + bounce) * scale - 28 },
        { scale: s * scale },
      ],
    };
  });

  const network = useMemo(() => NETWORK.map((line, index) => <NetworkLine key={index} frame={frame} index={index} line={line} />), [frame]);
  const nodes = useMemo(() => NODES.map((node, index) => <Node key={index} frame={frame} index={index} node={node} />), [frame]);

  return (
    <Pressable accessibilityLabel="Saltar la apertura" accessibilityRole="button" onPress={onDone} style={StyleSheet.absoluteFill}>
      <Backdrop glow={false} />
      <Svg height={height} preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill} viewBox="0 0 412 917" width={width}>
        <Defs>
          <LinearGradient gradientUnits="userSpaceOnUse" id="opening-logo" x1="0" x2="61" y1="0" y2="56">
            <Stop offset="0" stopColor="#cbb8ff" />
            <Stop offset="0.48" stopColor="#9d76f8" />
            <Stop offset="1" stopColor="#7d43e4" />
          </LinearGradient>
          <RadialGradient cx={LOGO_CX} cy={LOGO_CY} gradientUnits="userSpaceOnUse" id="opening-bloom" r={110}>
            <Stop offset="0" stopColor="#9d76f8" stopOpacity={0.5} />
            <Stop offset="1" stopColor="#9d76f8" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {network}
        <AnimatedCircle animatedProps={bloom} cx={LOGO_CX} cy={LOGO_CY} fill="url(#opening-bloom)" r={110} />
        {nodes}
        <AnimatedCircle animatedProps={landing} cx={199.5} cy={411.5} fill="none" stroke="#c4a8ff" strokeWidth={0.7} />
        <AnimatedG animatedProps={logoGroup}>
          <G transform={`translate(154.35 411.5) scale(${LOGO_SCALE})`}>
            <AnimatedPath animatedProps={logoTrace} d={LOGO} fill="none" stroke="#c4a8ff" strokeDasharray={[LOGO_LENGTH, LOGO_LENGTH]} strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.8} />
            <AnimatedPath animatedProps={logoFill} d={LOGO} fill="url(#opening-logo)" />
          </G>
        </AnimatedG>
        <AnimatedCircle animatedProps={ping} cx={LOGO_CX} cy={LOGO_CY} fill="none" stroke="#9d76f8" strokeDasharray={[5, 4]} strokeWidth={1.2} />
      </Svg>
      <Animated.View pointerEvents="none" style={[styles.pin, pinStyle]}>
        <Svg height={32} viewBox="-14 -28 28 32" width={28}>
          <Path d={PIN} fill="#090119" stroke="#c4a8ff" strokeLinejoin="round" strokeWidth={1.1} />
          <Circle cy={-16} fill="#9d76f8" r={3} />
          <Circle cy={-16} fill="#f7f3ff" r={1.25} />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', left: 0, top: 0, width: 28, height: 32, transformOrigin: '14px 28px' },
});
