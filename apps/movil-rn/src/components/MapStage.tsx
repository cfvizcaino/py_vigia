import { Camera, Map as MapView } from '@maplibre/maplibre-react-native';
import type { CameraRef, LngLatBounds } from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { tapFeedback } from './motion';
import { useScrollLock } from './ui';

// Estilo oscuro: en el Figma el mapa va sobre un rectángulo #090119 de radio 24.
export const mapStyle = 'https://tiles.openfreemap.org/styles/dark';
const PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
const FALLBACK_CENTER: [number, number] = [-74.8172, 11.0131];

export interface MapStageProps {
  height: number;
  /** What «Ver todo» shows, and where the map starts. */
  frame: LngLatBounds | null;
  /** When it changes, the map glides to the new frame (another route, other cameras). */
  frameKey: string;
  /** A point to glide to when it changes (the point just chosen). */
  focus?: [number, number] | null | undefined;
  caption?: { title: string; subtitle: string } | null | undefined;
  /** Inline: long press. Full screen: a tap is enough. */
  onPick?: ((point: [number, number]) => void) | undefined;
  fullscreenTitle: string;
  fullscreenHint?: string | undefined;
  /** Map sources and layers; they are drawn on the inline map and on the full-screen one. */
  children: ReactNode;
}

/**
 * Mapa dentro de una pantalla con scroll. Mientras un dedo está sobre él, la pantalla deja
 * de desplazarse, así que arrastrar mueve el mapa y no la página. Arranca encuadrando todos
 * los puntos, «Ver todo» vuelve a encuadrarlos y «Pantalla completa» lo abre sin nada que
 * compita por el gesto. Sin rotación ni inclinación accidentales con dos dedos.
 */
export function MapStage({ height, frame, frameKey, focus, caption, onPick, fullscreenTitle, fullscreenHint, children }: MapStageProps) {
  const lockScroll = useScrollLock();
  const cameraRef = useRef<CameraRef>(null);
  const fullCameraRef = useRef<CameraRef>(null);
  const [full, setFull] = useState(false);
  const [initial] = useState(frame);
  const lastFrame = useRef(frameKey);
  const lastFocus = useRef(focus?.join(','));

  useEffect(() => {
    if (frameKey === lastFrame.current || !frame) return;
    lastFrame.current = frameKey;
    cameraRef.current?.fitBounds(frame, { padding: PADDING, duration: 650, easing: 'ease' });
  }, [frame, frameKey]);

  useEffect(() => {
    const key = focus?.join(',');
    if (!focus || key === lastFocus.current) return;
    lastFocus.current = key;
    cameraRef.current?.easeTo({ center: focus, duration: 500 });
    fullCameraRef.current?.easeTo({ center: focus, duration: 500 });
  }, [focus]);

  // Never leave the page frozen if the screen goes away mid-touch.
  useEffect(() => () => lockScroll(false), [lockScroll]);

  const showAll = (ref: React.RefObject<CameraRef | null>) => {
    tapFeedback('selection');
    if (frame) ref.current?.fitBounds(frame, { padding: PADDING, duration: 600, easing: 'ease' });
  };
  const viewState = frame ? { bounds: frame, padding: PADDING } : { center: FALLBACK_CENTER, zoom: 12 };

  return (
    <View
      style={{ height, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.ink }}
      onTouchStart={() => lockScroll(true)}
      onTouchEnd={() => lockScroll(false)}
      onTouchCancel={() => lockScroll(false)}
    >
      <MapView mapStyle={mapStyle} style={{ flex: 1 }} attribution logo compass={false} touchRotate={false} touchPitch={false} onLongPress={(event) => onPick?.(event.nativeEvent.lngLat)}>
        <Camera ref={cameraRef} initialViewState={initial ? { bounds: initial, padding: PADDING } : { center: FALLBACK_CENTER, zoom: 12 }} />
        {children}
      </MapView>
      {caption ? (
        <View pointerEvents="none" style={styles.caption}>
          <Text style={type(fonts.poppins, 15)}>{caption.title}</Text>
          <Text style={[type(fonts.regular, 12), { color: '#d0d0d0' }]}>{caption.subtitle}</Text>
        </View>
      ) : null}
      <View style={styles.controls}>
        <MapButton icon="ms_zoom_out_map" label="Ver todos los puntos" onPress={() => showAll(cameraRef)} />
        <MapButton icon="ms_open_in_full" label="Abrir el mapa en pantalla completa" onPress={() => { tapFeedback(); setFull(true); }} />
      </View>

      <Modal visible={full} animationType="slide" statusBarTranslucent onRequestClose={() => setFull(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <MapView mapStyle={mapStyle} style={StyleSheet.absoluteFill} attribution logo compass={false} touchRotate={false} touchPitch={false} onPress={(event) => onPick?.(event.nativeEvent.lngLat)} onLongPress={(event) => onPick?.(event.nativeEvent.lngLat)}>
            <Camera ref={fullCameraRef} initialViewState={viewState} />
            {children}
          </MapView>
          <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View pointerEvents="box-none" style={styles.fullBar}>
              <MapButton icon="ms_close" label="Cerrar el mapa" onPress={() => setFull(false)} />
              <View pointerEvents="none" style={styles.fullTitle}><Text style={type(fonts.poppins, 16)}>{fullscreenTitle}</Text></View>
              <MapButton icon="ms_zoom_out_map" label="Ver todos los puntos" onPress={() => showAll(fullCameraRef)} />
            </View>
            {fullscreenHint ? (
              <View pointerEvents="none" style={styles.hint}><Text style={[type(fonts.regular, 12.5, 16), { textAlign: 'center' }]}>{fullscreenHint}</Text></View>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function MapButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={({ pressed }) => [styles.button, pressed && { opacity: 0.7, transform: [{ scale: 0.94 }] }]}>
      <Icon name={icon} size={18} color="#ffffff" />
    </Pressable>
  );
}

/** [west, south, east, north]; a single point gets a small box so the zoom stays sensible. */
export function boundsOf(points: [number, number][]): LngLatBounds | null {
  const first = points[0];
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const pad = 0.0025;
  if (east - west < pad) { west -= pad; east += pad; }
  if (north - south < pad) { south -= pad; north += pad; }
  return [west, south, east, north];
}

const styles = StyleSheet.create({
  caption: { position: 'absolute', left: 24, bottom: 18 },
  controls: { position: 'absolute', top: 12, right: 12, gap: 8 },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9,1,25,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  fullBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  fullTitle: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 19, backgroundColor: 'rgba(9,1,25,0.72)' },
  hint: { position: 'absolute', left: 24, right: 24, bottom: 36, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(9,1,25,0.8)' },
});
