import type { Device } from '../types/models';

/**
 * Where an edge node reads its video from, as in the Flutter app. The app only
 * uses this to build the install command for the node's PC: camera addresses
 * and passwords never go to the central server. `thisPhone` needs no PC.
 */
export type EdgeSource = 'thisPhone' | 'phoneUsb' | 'phoneLan' | 'rtsp' | 'http' | 'usbCamera';

export const edgeSources: readonly EdgeSource[] = ['thisPhone', 'phoneUsb', 'phoneLan', 'rtsp', 'http', 'usbCamera'];

export const edgeSourceLabel: Readonly<Record<EdgeSource, string>> = {
  thisPhone: 'Este teléfono · detección integrada (sin PC)',
  phoneUsb: 'Teléfono con VIGÍA · cable USB',
  phoneLan: 'Teléfono con VIGÍA · red local',
  rtsp: 'Cámara RTSP (Tapo, Hikvision…)',
  http: 'Flujo HTTP / MJPEG',
  usbCamera: 'Webcam USB del PC',
};

export const edgeSourceField: Readonly<Record<EdgeSource, { label: string; hint: string }>> = {
  thisPhone: { label: '', hint: '' },
  phoneUsb: { label: 'Puerto local en el PC', hint: '8082' },
  phoneLan: { label: 'IP del teléfono en la red local', hint: '192.168.1.40' },
  rtsp: { label: 'URL RTSP sin usuario ni contraseña', hint: 'rtsp://192.168.1.50:554/stream1' },
  http: { label: 'URL del flujo', hint: 'http://192.168.1.60:8080/video' },
  usbCamera: { label: 'Dispositivo de video', hint: '/dev/video2' },
};

/** Phones on the LAN are protected by their access key; RTSP cameras almost always ask for credentials. */
export function authByDefault(source: EdgeSource): boolean {
  return source === 'phoneLan' || source === 'rtsp';
}

/** Sources read by a vision node on a PC, which needs an install command. */
export function needsNodePc(source: EdgeSource): boolean {
  return source !== 'thisPhone';
}

/** Next free CEL-NN identifier. */
export function suggestEdgeId(devices: Pick<Device, 'external_id'>[]): string {
  const used = new Set(
    devices
      .map((device) => /^CEL-(\d+)$/.exec(device.external_id)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number),
  );
  let next = 1;
  while (used.has(next)) next++;
  return `CEL-${String(next).padStart(2, '0')}`;
}

/** Suggested local port for a phone over USB: CEL-02 → 8082. */
export function suggestPhonePort(cameraId: string): string {
  const number = Number(/(\d+)$/.exec(cameraId)?.[1] ?? 1) || 1;
  return String(8080 + Math.min(99, Math.max(1, number)));
}

export function validateSource(source: EdgeSource, value: string): string | null {
  const text = value.trim();
  switch (source) {
    case 'thisPhone':
      return null;
    case 'phoneUsb': {
      const port = Number(text);
      return !/^\d+$/.test(text) || port < 1024 || port > 65535 ? 'Usa un puerto entre 1024 y 65535.' : null;
    }
    case 'phoneLan': {
      const parts = text.split('.');
      const valid = parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
      return valid ? null : 'Escribe una IPv4, p. ej. 192.168.1.40.';
    }
    case 'rtsp':
      return validateUrl(text, ['rtsp', 'rtsps']);
    case 'http':
      return validateUrl(text, ['http', 'https']);
    case 'usbCamera':
      return /^\/dev\/video\d+$/.test(text) ? null : 'Usa la forma /dev/videoN.';
  }
}

function validateUrl(text: string, schemes: string[]): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(?:([^@/]*)@)?([^/:?#]*)(?::(\d+))?/i.exec(text);
  const scheme = match?.[1]?.toLowerCase();
  if (!match || !scheme || !schemes.includes(scheme) || !match[3]) {
    return `Debe empezar por ${schemes.map((item) => `${item}://`).join(' o ')} e incluir el host.`;
  }
  if (match[2]) return 'Quita usuario y contraseña de la URL: el script del PC los pide sin mostrarlos.';
  if (match[4] && (Number(match[4]) < 1 || Number(match[4]) > 65535)) return 'Puerto no válido.';
  return null;
}

/** The value the node's install script expects as its source argument. */
export function sourceArgument(source: EdgeSource, value: string): string {
  const text = value.trim();
  return source === 'phoneLan' ? `http://${text}:8080/video` : text;
}

export function installCommand(input: {
  cameraId: string;
  source: EdgeSource;
  value: string;
  serverUrl: string;
  needsAuth: boolean;
}): string {
  const argument = sourceArgument(input.source, input.value);
  const quoted = argument.includes('://') ? `'${argument}'` : argument;
  return `bash infra/edges/install-node-token.sh ${input.cameraId} ${quoted} ${input.serverUrl}${input.needsAuth ? ' --auth' : ''}`;
}
