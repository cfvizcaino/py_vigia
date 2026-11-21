import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useSession } from '../state/session';
import { colors } from '../theme/colors';
import { fonts, type } from '../theme/fonts';
import { Icon } from './Icon';

type Source = { uri: string; headers: Record<string, string> };

/**
 * Recorte del vehículo en un paso de la ruta, como en la consola web: solo admin (lo pide
 * la sesión y lo exige el backend) y cada vista queda en la auditoría. Al tocarlo se abre
 * ampliado. Un recorte dura 7 días: después el centro responde 404 y se dice «vencido».
 */
export function RecorteThumb({ detectionId, caption }: { detectionId: string; caption: string }) {
  const { thumbnailSource } = useSession();
  const [source, setSource] = useState<Source | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    thumbnailSource(detectionId)
      .then((next) => { if (active) setSource(next); })
      .catch(() => { if (active) setState('broken'); });
    return () => { active = false; };
  }, [detectionId, thumbnailSource]);

  if (state === 'broken') return <View style={[styles.thumb, styles.empty]}><Text style={styles.emptyText}>Recorte vencido</Text></View>;
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Ampliar recorte · ${caption}`}
        disabled={state !== 'ready'}
        onPress={() => setOpen(true)}
        style={styles.thumb}
      >
        {source ? (
          <Image
            testID={`recorte-${detectionId}`}
            source={source}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={() => setState('ready')}
            onError={() => setState('broken')}
          />
        ) : null}
        {state === 'loading' ? <ActivityIndicator color={colors.text} style={StyleSheet.absoluteFill} /> : (
          <View style={styles.zoomHint}><Icon name="ms_zoom_out_map" size={12} color="#ffffff" /></View>
        )}
      </Pressable>
      {source ? <RecorteViewer source={source} caption={caption} visible={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function NoRecorte() {
  return <View style={[styles.thumb, styles.empty]}><Text style={styles.emptyText}>Sin recorte</Text></View>;
}

/** El recorte a todo el ancho, sobre un velo oscuro: tocar fuera o «Cerrar» lo cierra. */
export function RecorteViewer({ source, caption, visible, onClose }: { source: Source; caption: string; visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [ratio, setRatio] = useState(4 / 3);
  const imageWidth = Math.min(width - 32, 720);
  const imageHeight = Math.min(imageWidth / ratio, height * 0.7);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Cerrar recorte ampliado" style={styles.backdrop} onPress={onClose}>
        <Image
          accessibilityLabel={`Recorte ampliado · ${caption}`}
          source={source}
          resizeMode="contain"
          style={{ width: imageWidth, height: imageHeight, borderRadius: 14 }}
          onLoad={(event) => {
            const { width: w, height: h } = event.nativeEvent.source;
            if (w > 0 && h > 0) setRatio(w / h);
          }}
        />
        <Text style={[type(fonts.regular, 13, 18), styles.caption]}>{caption}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} onPress={onClose} style={styles.close}>
          <Icon name="ms_close" size={18} color="#ffffff" />
          <Text style={type(fonts.medium, 14)}>Cerrar</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 88, height: 66, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(9,1,25,0.6)', justifyContent: 'center', alignItems: 'center' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'transparent' },
  emptyText: { ...type(fonts.light, 9, 11), textAlign: 'center', opacity: 0.85 },
  zoomHint: { position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(4,0,12,0.94)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 },
  caption: { textAlign: 'center', opacity: 0.9, maxWidth: 520 },
  close: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
});
