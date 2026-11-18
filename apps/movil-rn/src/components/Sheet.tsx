import { useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { Icon } from './Icon';

const easeOut = Easing.out(Easing.cubic);
const easeIn = Easing.in(Easing.cubic);

/**
 * Ventana que sube desde abajo sobre un velo oscuro. Se cierra con «atrás» (botón o gesto de
 * Android), tocando fuera de ella o con su botón de cerrar, y también anima la salida: el
 * Modal sigue montado hasta que termina de bajar.
 */
export function Sheet({ visible, title, subtitle, onClose, children }: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string | undefined;
  onClose: () => void;
}>) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  // Opening mounts right away (adjusting state while rendering, as React recommends);
  // closing keeps the Modal until the panel has slid out.
  if (visible && !mounted) setMounted(true);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.set(withTiming(1, { duration: reduced ? 0 : 340, easing: easeOut }));
    } else {
      progress.set(withTiming(0, { duration: reduced ? 0 : 240, easing: easeIn }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      }));
    }
  }, [progress, reduced, visible]);

  const veil = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.get()) * height }] }));

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar ventana" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { maxHeight: height * 0.86, paddingBottom: insets.bottom + 16 }, panel]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={type(fonts.poppins, 20, 24)}>{title}</Text>
            {subtitle ? <Text style={[type(fonts.light, 12, 15), { opacity: 0.85 }]}>{subtitle}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} onPress={onClose} style={styles.close}>
            <Icon name="ms_close" size={20} color="#ffffff" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  veil: { backgroundColor: 'rgba(9,1,25,0.66)' },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingBottom: 12 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  body: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
});
