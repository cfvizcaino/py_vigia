import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Largest width × height with the given shape (width / height) that fits in the space. */
export function fitContain(spaceWidth: number, spaceHeight: number, aspectRatio: number): { width: number; height: number } {
  if (spaceWidth <= 0 || spaceHeight <= 0 || !(aspectRatio > 0)) return { width: 0, height: 0 };
  return spaceWidth / spaceHeight > aspectRatio
    ? { width: spaceHeight * aspectRatio, height: spaceHeight }
    : { width: spaceWidth, height: spaceWidth / aspectRatio };
}

/**
 * Centres a box with exactly the frame's shape in whatever space it gets.
 * Boxes drawn as fractions of the frame only line up with the image when the
 * preview has that same shape; any leftover space stays black.
 */
function FittedFrame({ aspectRatio, children }: { aspectRatio: number; children: ReactNode }) {
  const [space, setSpace] = useState<{ width: number; height: number } | null>(null);
  const size = space ? fitContain(space.width, space.height, aspectRatio) : null;
  return (
    <View
      style={styles.center}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSpace((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
      }}
    >
      {size && size.width > 0 ? <View style={{ width: size.width, height: size.height }}>{children}</View> : null}
    </View>
  );
}

/**
 * Camera preview that can be enlarged to the whole screen. Only one copy of
 * the preview exists at a time, so enlarging restarts the camera view once.
 */
export function ExpandablePreview({ aspectRatio, inlineMaxHeight, footer, renderPreview }: {
  /** Shape of the frame (width / height) as it is shown. */
  aspectRatio: number;
  inlineMaxHeight: number;
  /** Short status shown under the full-screen preview. */
  footer?: ReactNode;
  renderPreview: () => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <Modal animationType="fade" onRequestClose={() => setExpanded(false)} statusBarTranslucent visible>
        <SafeAreaView style={styles.fullscreen} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.fullscreenPreview}>
            <FittedFrame aspectRatio={aspectRatio}>{renderPreview()}</FittedFrame>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reducir vista de cámara"
              hitSlop={8}
              onPress={() => setExpanded(false)}
              style={[styles.toggle, styles.toggleFullscreen]}
            >
              <MaterialIcons name="fullscreen-exit" size={28} color="#FFFFFF" />
            </Pressable>
          </View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <View style={[styles.inline, { aspectRatio, maxHeight: inlineMaxHeight }]}>
      <FittedFrame aspectRatio={aspectRatio}>{renderPreview()}</FittedFrame>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ampliar vista de cámara"
        hitSlop={8}
        onPress={() => setExpanded(true)}
        style={[styles.toggle, styles.toggleInline]}
      >
        <MaterialIcons name="fullscreen" size={26} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inline: { width: '100%', backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenPreview: { flex: 1 },
  footer: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0B1411' },
  toggle: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  toggleInline: { top: 8, right: 8 },
  toggleFullscreen: { top: 12, right: 12 },
});
