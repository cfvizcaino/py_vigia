import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text } from 'react-native';
import type { PropsWithChildren } from 'react';

import { Dialog, PillButton } from '../components/ui';
import { openVerifiedApk } from '../native/installer';
import { preferences } from '../storage/preferences';
import { fonts, type } from '../theme/fonts';
import { classifyUpdate, downloadVerifiedApk, fetchAppRelease, readInstalledVersion } from './release';
import type { AppRelease, UpdateLevel } from './release';

const dismissedVersionKey = 'vigia_update_dismissed_version';
const dismissedAtKey = 'vigia_update_dismissed_at';
const checkIntervalMs = 24 * 60 * 60 * 1000;

/** What the published release asks of this install, and a way to open the update dialog. */
interface UpdateState {
  available: UpdateLevel;
  showUpdate: () => void;
}

const UpdateContext = createContext<UpdateState>({ available: 'none', showUpdate: () => undefined });

/** For screens that run unattended (edge autónomo): a notice instead of the dialog. */
export function useAppUpdate(): UpdateState {
  return useContext(UpdateContext);
}

export function UpdateHost({ children }: PropsWithChildren) {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [level, setLevel] = useState<UpdateLevel>('none');
  const [available, setAvailable] = useState<UpdateLevel>('none');
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
        setAvailable(nextLevel);
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
    <UpdateContext.Provider value={{ available, showUpdate: () => setLevel(available) }}>
      {children}
      <Dialog
        visible={visible}
        icon={error ? 'report' : undefined}
        title={error ? 'No se pudo descargar la actualización' : isRequired ? 'Actualización obligatoria' : 'Nueva versión disponible'}
        body={error ?? (isRequired
          ? `La versión instalada (${installed}) quedó por debajo del mínimo. Hay que actualizar para seguir.`
          : `La versión instalada es la ${installed} y la publicada es la ${release?.latest ?? 'nueva'}. Puedes seguir con esta y actualizar cuando quieras.`)}
        onRequestClose={() => {
          if (!isRequired) setLevel('none');
        }}
      >
        {!error && release?.size_bytes ? (
          <Text style={[type(fonts.poppinsLight, 11), { textAlign: 'center', opacity: 0.7 }]}>
            APK de {(release.size_bytes / 1_048_576).toFixed(1)} MB · se abre solo después de verificar su SHA-256.
          </Text>
        ) : null}
        {!error && release?.notes ? <Text style={[type(fonts.poppinsLight, 12), { textAlign: 'center' }]}>{release.notes}</Text> : null}
        <PillButton
          title={error ? 'Reintentar' : Platform.OS === 'android' ? 'Actualizar' : 'Distribución iOS futura'}
          accessibilityLabel={Platform.OS === 'android' ? 'Descargar y verificar APK' : 'Distribución iOS futura'}
          variant={error ? 'white' : 'accent'}
          height={37}
          fontSize={16}
          loading={busy}
          disabled={Platform.OS !== 'android'}
          onPress={() => void update()}
          style={{ alignSelf: 'center', width: 190 }}
        />
        {!isRequired ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => void dismissOptional()}>
            <Text style={[type(fonts.poppins, 16), { textAlign: 'center' }]}>{Platform.OS === 'ios' ? 'Continuar' : 'Más tarde'}</Text>
          </Pressable>
        ) : null}
      </Dialog>
    </UpdateContext.Provider>
  );
}
