import type { Device, DeviceActivity } from '../types/models';

/**
 * Lo que de verdad está haciendo cada nodo, según su latido (backend: liveness.py).
 * Con un servidor anterior, sin `activity`, se usa el estado registrado.
 */
export type ActivityTone = 'ok' | 'warn' | 'off';

const labels: Record<DeviceActivity['state'], { label: string; tone: ActivityTone }> = {
  active: { label: 'Detectando', tone: 'ok' },
  background: { label: 'En segundo plano', tone: 'warn' },
  stopped: { label: 'Detenido', tone: 'off' },
  no_signal: { label: 'Sin señal', tone: 'warn' },
  never: { label: 'Sin conectar', tone: 'off' },
  simulated: { label: 'Simulada', tone: 'off' },
};

export function activityLabel(device: Pick<Device, 'status' | 'activity'>): { label: string; tone: ActivityTone } {
  if (device.activity) return labels[device.activity.state];
  if (device.status === 'online') return { label: 'En línea', tone: 'ok' };
  if (device.status === 'simulated') return labels.simulated;
  return { label: 'Sin conexión', tone: 'off' };
}

/** What the state means for whoever is looking after the phone. */
export function activityExplanation(activity: DeviceActivity | null | undefined): string | null {
  switch (activity?.state) {
    case 'active': return 'El edge está analizando y enviando al servidor.';
    case 'background': return 'La app quedó en segundo plano: el edge no analiza hasta que vuelva a primer plano.';
    case 'stopped': return 'Alguien detuvo el edge desde el teléfono.';
    case 'no_signal': return 'Dejó de responder sin avisar: la app se cerró, el teléfono perdió la red o se quedó sin batería.';
    case 'never': return 'Este nodo todavía no se ha conectado.';
    default: return null;
  }
}

export function elapsedLabel(from: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** «hace 3 min · v1.5.0 · 6,2 análisis/s · 4 en cola · batería 83 %», with what is known. */
export function activityDetail(activity: DeviceActivity | null | undefined, now: number = Date.now()): string | null {
  if (!activity || activity.state === 'simulated') return null;
  const parts: string[] = [];
  if (activity.last_contact_at) parts.push(`Último contacto ${elapsedLabel(activity.last_contact_at, now)}`);
  if (activity.node_version) parts.push(`v${activity.node_version.replace(/^movil-/, '')}`);
  if (activity.state === 'active' && activity.analyses_per_second != null) {
    parts.push(`${activity.analyses_per_second.toFixed(1).replace('.', ',')} análisis/s`);
  }
  if (activity.pending_events) parts.push(`${activity.pending_events} en cola`);
  if (activity.battery != null) parts.push(`batería ${Math.round(activity.battery * 100)} %`);
  return parts.length ? parts.join(' · ') : null;
}
