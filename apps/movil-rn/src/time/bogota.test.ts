import { describe, expect, it } from '@jest/globals';

import { bogotaDateTime, bogotaToUtc, parseApiDate } from './bogota';

describe('fechas de operación en America/Bogota', () => {
  it('convierte hora local a UTC sin depender de la zona del teléfono', () => {
    expect(bogotaToUtc('2026-10-28', '14:20')).toBe('2026-10-28T19:20:00.000Z');
  });

  it('interpreta fechas antiguas sin offset como UTC', () => {
    expect(parseApiDate('2026-10-28T19:20:00').toISOString()).toBe('2026-10-28T19:20:00.000Z');
    expect(parseApiDate('2026-10-28T19:20:00-05:00').toISOString()).toBe('2026-10-29T00:20:00.000Z');
  });

  it('presenta una marca UTC como hora Bogotá', () => {
    expect(bogotaDateTime(new Date('2026-10-28T19:20:00Z'))).toContain('2026-10-28 14:20');
  });

  it('rechaza fecha y hora con formato inválido', () => {
    expect(() => bogotaToUtc('28-10-2026', '14:20')).toThrow(RangeError);
    expect(() => bogotaToUtc('2026-10-28', '25:20')).toThrow(RangeError);
    expect(() => bogotaToUtc('2026-02-30', '14:20')).toThrow(RangeError);
  });
});
