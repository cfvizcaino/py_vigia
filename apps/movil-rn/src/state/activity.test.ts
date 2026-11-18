import { describe, expect, test } from '@jest/globals';

import { activityDetail, activityLabel, elapsedLabel } from './activity';
import type { DeviceActivity } from '../types/models';

const now = Date.parse('2026-11-18T12:00:00Z');

function activity(fields: Partial<DeviceActivity>): DeviceActivity {
  return {
    state: 'active', last_contact_at: null, last_heartbeat_at: null, last_event_at: null, node_version: null,
    analyses_per_second: null, active_tracks: null, pending_events: null, delivered_events: null,
    last_error: null, battery: null, ...fields,
  };
}

describe('estado de los nodos', () => {
  test('etiqueta según el latido y, sin él, según el estado registrado', () => {
    expect(activityLabel({ status: 'offline', activity: activity({ state: 'active' }) })).toEqual({ label: 'Detectando', tone: 'ok' });
    expect(activityLabel({ status: 'offline', activity: activity({ state: 'no_signal' }) }).label).toBe('Sin señal');
    expect(activityLabel({ status: 'offline', activity: activity({ state: 'background' }) }).label).toBe('En segundo plano');
    expect(activityLabel({ status: 'online' }).label).toBe('En línea');
    expect(activityLabel({ status: 'offline', activity: null }).label).toBe('Sin conexión');
  });

  test('tiempo transcurrido en segundos, minutos, horas y días', () => {
    expect(elapsedLabel('2026-11-18T11:59:40Z', now)).toBe('hace 20 s');
    expect(elapsedLabel('2026-11-18T11:57:00Z', now)).toBe('hace 3 min');
    expect(elapsedLabel('2026-11-18T09:00:00Z', now)).toBe('hace 3 h');
    expect(elapsedLabel('2026-11-15T12:00:00Z', now)).toBe('hace 3 d');
  });

  test('el detalle junta contacto, versión, ritmo, cola y batería', () => {
    expect(activityDetail(activity({
      last_contact_at: '2026-11-18T11:57:00Z', node_version: '1.5.0', analyses_per_second: 6.24,
      pending_events: 4, battery: 0.83,
    }), now)).toBe('Último contacto hace 3 min · v1.5.0 · 6,2 análisis/s · 4 en cola · batería 83 %');
    // The pace only makes sense while it is detecting.
    expect(activityDetail(activity({ state: 'no_signal', last_contact_at: '2026-11-18T09:00:00Z', analyses_per_second: 6 }), now))
      .toBe('Último contacto hace 3 h');
    expect(activityDetail(activity({ state: 'simulated' }), now)).toBeNull();
  });
});
