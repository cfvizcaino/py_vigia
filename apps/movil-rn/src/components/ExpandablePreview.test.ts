import { describe, expect, it } from '@jest/globals';

import { fitContain } from './ExpandablePreview';

describe('fitContain', () => {
  it('ajusta un frame vertical al alto cuando el espacio es más ancho', () => {
    expect(fitContain(984, 460, 3 / 4)).toEqual({ width: 345, height: 460 });
  });

  it('ajusta al ancho cuando el espacio es más alto que el frame', () => {
    expect(fitContain(1080, 2000, 3 / 4)).toEqual({ width: 1080, height: 1440 });
  });

  it('ocupa todo el espacio cuando ya tiene la forma del frame', () => {
    expect(fitContain(900, 1600, 9 / 16)).toEqual({ width: 900, height: 1600 });
  });

  it('no dibuja nada sin espacio o con una forma inválida', () => {
    expect(fitContain(0, 400, 3 / 4)).toEqual({ width: 0, height: 0 });
    expect(fitContain(400, 400, 0)).toEqual({ width: 0, height: 0 });
  });
});
