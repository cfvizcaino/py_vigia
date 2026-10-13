import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:movil/app_update.dart';

void main() {
  test('una versión más nueva es opcional y quedar bajo el mínimo es obligatorio', () {
    expect(compareVersions('1.2.0', '1.2.0'), 0);
    expect(compareVersions('1.2.0', '1.3.0'), lessThan(0));
    expect(compareVersions('1.10.0', '1.9.0'), greaterThan(0));
    expect(classifyUpdate('1.2.0', '1.3.0', '1.0.0'), UpdateLevel.optional);
    expect(classifyUpdate('1.2.0', '1.2.0', '1.0.0'), UpdateLevel.none);
    expect(classifyUpdate('1.1.0', '1.3.0', '1.2.0'), UpdateLevel.required);
    expect(classifyUpdate('1.2.0', null, null), UpdateLevel.none);
    expect(classifyUpdate('1.2.0', 'no-es-version', '1.0.0'), UpdateLevel.none);
  });

  test('no abre el instalador si el SHA-256 no coincide', () async {
    final directory = await Directory.systemTemp.createTemp('vigia-apk');
    addTearDown(() => directory.delete(recursive: true));
    final bytes = [1, 2, 3, 4];
    final digest = sha256.convert(bytes).toString();
    final client = MockClient((request) async => http.Response.bytes(bytes, 200));

    final file = await downloadVerifiedApk(
      client: client,
      url: Uri.parse('https://vigia.example/descargas/vigia-1.3.0.apk'),
      expectedSha256: digest.toUpperCase(),
      directory: directory,
    );
    expect(await file.readAsBytes(), bytes);

    expect(
      () => downloadVerifiedApk(
        client: client,
        url: Uri.parse('https://vigia.example/descargas/vigia-1.3.0.apk'),
        expectedSha256: 'ab' * 32,
        directory: directory,
      ),
      throwsA(isA<UpdateException>().having((error) => error.message, 'message', contains('huella'))),
    );
  });
}
