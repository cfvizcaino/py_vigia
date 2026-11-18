/**
 * Movimiento común de la app: entradas suaves, respuesta al tocar y puntos «en vivo».
 *
 * Reglas: curvas de salida (ease-out) sin rebote ni resorte, duraciones cortas
 * (120–420 ms) y nada de movimiento si el sistema pide reducirlo.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const easeOut = Easing.out(Easing.cubic);

/** Scale and dim while pressed, for the whole control (background included). */
export function usePressScale(pressedScale = 0.96) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const onPressIn = useCallback(() => {
    setPressed(true);
    if (!reduced) scale.set(withTiming(pressedScale, { duration: 110, easing: easeOut }));
  }, [pressedScale, reduced, scale]);
  const onPressOut = useCallback(() => {
    setPressed(false);
    scale.set(withTiming(1, { duration: 180, easing: easeOut }));
  }, [scale]);
  return { animatedStyle, onPressIn, onPressOut, pressed };
}

/** A light tap for confirmations and a tick for selections; silent where unsupported. */
export function tapFeedback(kind: 'impact' | 'selection' = 'impact'): void {
  const run = kind === 'selection' ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void run.catch(() => undefined);
}

/** Items of a list come in one after another (55 ms apart, at most 8 steps). */
export function Reveal({ index = 0, children, style }: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.duration(380).delay(Math.min(index, 8) * 55).easing(easeOut).withInitialValues({ transform: [{ translateY: 10 }] }).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Fades and lifts a screen's content every time the screen gains focus (stack pushes and
 * tab switches), so moving around the app feels continuous instead of cut.
 */
export function useFocusEntrance(subscribe: ((listener: () => void) => () => void) | null) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    if (!subscribe || reduced) return undefined;
    const play = () => {
      progress.set(0);
      progress.set(withTiming(1, { duration: 320, easing: easeOut }));
    };
    play();
    return subscribe(play);
  }, [progress, reduced, subscribe]);
  return useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 12 }],
  }));
}

/** Small dot that breathes while something is live (an edge detecting, a node sending). */
export function PulseDot({ color, size = 8, live = true }: { color: string; size?: number; live?: boolean }) {
  const reduced = useReducedMotion();
  const halo = useSharedValue(0);
  useEffect(() => {
    if (!live || reduced) {
      cancelAnimation(halo);
      halo.set(0);
      return undefined;
    }
    halo.set(withRepeat(withSequence(withTiming(1, { duration: 1100, easing: easeOut }), withTiming(0, { duration: 0 })), -1));
    return () => cancelAnimation(halo);
  }, [halo, live, reduced]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - halo.get()), transform: [{ scale: 1 + halo.get() * 1.6 }] }));
  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, haloStyle]} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </Animated.View>
  );
}
