import { describe, expect, test } from '@jest/globals';

import { installCommand, suggestEdgeId, suggestPhonePort, validateSource } from './sources';

describe('alta de edge', () => {
  test('sugiere el siguiente CEL libre y su puerto USB', () => {
    expect(suggestEdgeId([{ external_id: 'CEL-01' }, { external_id: 'CEL-03' }, { external_id: 'CAM-02' }])).toBe('CEL-02');
    expect(suggestPhonePort('CEL-02')).toBe('8082');
    expect(suggestPhonePort('PORTERIA')).toBe('8081');
  });

  test('valida cada fuente como Flutter', () => {
    expect(validateSource('phoneUsb', '80')).toMatch(/1024/);
    expect(validateSource('phoneLan', '192.168.1.400')).toMatch(/IPv4/);
    expect(validateSource('rtsp', 'rtsp://admin:clave@192.168.1.50/stream')).toMatch(/usuario y contraseña/);
    expect(validateSource('http', 'rtsp://192.168.1.50')).toMatch(/http:\/\//);
    expect(validateSource('usbCamera', '/dev/video2')).toBeNull();
    expect(validateSource('thisPhone', '')).toBeNull();
  });

  test('arma el comando del nodo sin credenciales en la URL', () => {
    expect(installCommand({ cameraId: 'CEL-05', source: 'phoneLan', value: '192.168.1.40', serverUrl: 'https://vigia.example', needsAuth: true }))
      .toBe("bash infra/edges/install-node-token.sh CEL-05 'http://192.168.1.40:8080/video' https://vigia.example --auth");
    expect(installCommand({ cameraId: 'CEL-02', source: 'phoneUsb', value: '8082', serverUrl: 'https://vigia.example', needsAuth: false }))
      .toBe('bash infra/edges/install-node-token.sh CEL-02 8082 https://vigia.example');
  });
});
