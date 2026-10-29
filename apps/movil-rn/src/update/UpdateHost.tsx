import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';

import { PrimaryButton, SecondaryButton } from '../components/ui';
import { openVerifiedApk } from '../native/installer';
import { preferences } from '../storage/preferences';
import { colors } from '../theme/colors';
import { classifyUpdate, downloadVerifiedApk, fetchAppRelease, readInstalledVersion } from './release';
import type { AppRelease, UpdateLevel } from './release';

const dismissedVersionKey = 'vigia_update_dismissed_version';
const dismissedAtKey = 'vigia_update_dismissed_at';
const checkIntervalMs = 24 * 60 * 60 * 1000;

export function UpdateHost({ children }: PropsWithChildren) {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [level, setLevel] = useState<UpdateLevel>('none');
  const [installed, setInstalled] = useState(readInstalledVersion());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCheckedAt = useRef(0);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const baseUrl = await preferences.getApiUrl();
        const nextRelease = await fetchAppRelease(baseUrl);
        if (!active || !nextRelease) return;
        const appVersion = readInstalledVersion();
        const nextLevel = classifyUpdate(appVersion, nextRelease.latest, nextRelease.minimum);
        setInstalled(appVersion);
        setRelease(nextRelease);
        setError(null);
        if (nextLevel === 'optional' && nextRelease.latest) {
          const [dismissedVersion, dismissedAt] = await Promise.all([
            preferences.get(dismissedVersionKey),
            preferences.get(dismissedAtKey),
          ]);
          if (!active) return;
          const dismissedDate = dismissedAt ? Date.parse(dismissedAt) : Number.NaN;
          if (dismissedVersion === nextRelease.latest
            && Number.isFinite(dismissedDate)
            && Date.now() - dismissedDate < checkIntervalMs) {
            setLevel('none');
            return;
          }
        }
        setLevel(nextLevel);
      } catch {
        return;
      } finally {
        lastCheckedAt.current = Date.now();
      }
    };

    void check();
    const timer = setInterval(() => void check(), checkIntervalMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastCheckedAt.current >= checkIntervalMs) void check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const dismissOptional = async () => {
    if (Platform.OS === 'ios' && level === 'required') {
      setLevel('none');
      return;
    }
    if (level !== 'optional' || !release?.latest) return;
    await Promise.all([
      preferences.set(dismissedVersionKey, release.latest),
      preferences.set(dismissedAtKey, new Date().toISOString()),
    ]);
    setLevel('none');
  };

  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      if (Platform.OS !== 'android') {
        throw new Error('Las actualizaciones APK solo se instalan en Android. La distribución iOS se preparará por separado.');
      }
      if (!release) throw new Error('No hay datos de actualización disponibles.');
      const apk = await downloadVerifiedApk(release);
      if (!release.sha256) throw new Error('La publicación no incluye una huella SHA-256 válida.');
      const installer = await openVerifiedApk(apk.uri, release.sha256);
      if (installer.permissionRequired) {
        setError('Autoriza a VIGÍA a instalar aplicaciones en Ajustes y vuelve a tocar “Descargar y verificar APK”.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible descargar o abrir la actualización.');
    } finally {
      setBusy(false);
    }
  };

  const isRequired = level === 'required' && Platform.OS === 'android';
  const visible = level !== 'none' && release !== null;

  return (
    <>
      {children}
      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!isRequired) setLevel('none');
        }}
        transparent
        visible={visible}
      >
        <View style={{ flex: 1, backgroundColor: '#000B', justifyContent: 'center', padding: 22 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, gap: 14 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>
              {isRequired ? 'Actualización obligatoria' : 'Hay una versión nueva'}
            </Text>
            <Text style={{ color: colors.muted, lineHeight: 21 }}>
              {isRequired
                ? `La versión instalada (${installed}) quedó por debajo del mínimo. Actualiza para seguir usando VIGÍA.`
                : `Versión instalada ${installed}; versión publicada ${release?.latest ?? 'disponible'}.`}
            </Text>
            {release?.notes ? <Text style={{ color: colors.text, lineHeight: 20 }}>{release.notes}</Text> : null}
            {Platform.OS === 'ios' ? (
              <Text style={{ color: colors.warning, lineHeight: 20 }}>
                iOS no instala APK. La verificación de versiones se conserva y el enlace de distribución iOS se integrará cuando esté disponible.
              </Text>
            ) : (
              <Text style={{ color: colors.subtle, lineHeight: 19 }}>
                El APK solo se abrirá después de verificar su SHA-256. Android puede solicitar permiso para instalar aplicaciones de esta fuente.
              </Text>
            )}
            {error ? <Text accessibilityRole="alert" style={{ color: colors.danger, lineHeight: 20 }}>{error}</Text> : null}
            <PrimaryButton title={Platform.OS === 'android' ? 'Descargar y verificar APK' : 'Distribución iOS futura'} onPress={() => void update()} loading={busy} disabled={Platform.OS !== 'android'} />
            {!isRequired ? <SecondaryButton title={Platform.OS === 'ios' ? 'Continuar' : 'Recordar en 24 horas'} onPress={() => void dismissOptional()} /> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
