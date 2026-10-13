import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

/// Fallback when the build does not expose a version name. Release APKs read
/// the version from the package itself.
const installedAppVersionFallback = '1.3.0';

enum UpdateLevel { none, optional, required }

class AppRelease {
  const AppRelease({
    this.latest,
    this.minimum,
    this.apkUrl,
    this.sha256,
    this.notes = '',
  });

  final String? latest;
  final String? minimum;
  final String? apkUrl;
  final String? sha256;
  final String notes;

  factory AppRelease.fromJson(Map<String, dynamic> json) => AppRelease(
    latest: json['latest'] as String?,
    minimum: json['minimum'] as String?,
    apkUrl: json['apk_url'] as String?,
    sha256: json['sha256'] as String?,
    notes: (json['notes'] as String?) ?? '',
  );
}

class UpdateException implements Exception {
  const UpdateException(this.message);
  final String message;
}

/// Compares X.Y.Z. An unreadable version compares equal, so a bad document
/// cannot force an update.
int compareVersions(String left, String right) {
  int? part(String version, int index) {
    final core = version.split('+').first.split('-').first;
    final parts = core.split('.');
    if (parts.length != 3) return null;
    return int.tryParse(parts[index]);
  }

  for (var index = 0; index < 3; index++) {
    final a = part(left, index);
    final b = part(right, index);
    if (a == null || b == null) return 0;
    final order = a.compareTo(b);
    if (order != 0) return order;
  }
  return 0;
}

UpdateLevel classifyUpdate(String installed, String? latest, String? minimum) {
  if (minimum != null && compareVersions(installed, minimum) < 0) {
    return UpdateLevel.required;
  }
  if (latest != null && compareVersions(installed, latest) < 0) {
    return UpdateLevel.optional;
  }
  return UpdateLevel.none;
}

Future<String> readInstalledVersion() async {
  final info = await PackageInfo.fromPlatform();
  final version = info.version.trim();
  return version.isEmpty ? installedAppVersionFallback : version;
}

Future<AppRelease?> fetchAppRelease(http.Client client, String baseUrl) async {
  final root = baseUrl.replaceAll(RegExp(r'/+$'), '');
  final response = await client
      .get(Uri.parse('$root/api/v1/app/version'))
      .timeout(const Duration(seconds: 15));
  if (response.statusCode != 200) return null;
  final decoded = response.body.isEmpty ? null : _decode(response.body);
  if (decoded is! Map<String, dynamic>) return null;
  return AppRelease.fromJson(decoded);
}

Object? _decode(String body) {
  try {
    return jsonDecode(body);
  } on FormatException {
    return null;
  }
}

/// Downloads the APK and refuses to hand it to the installer unless the
/// SHA-256 matches the one published with the release.
Future<File> downloadVerifiedApk({
  required http.Client client,
  required Uri url,
  required String expectedSha256,
  required Directory directory,
}) async {
  final response = await client.get(url).timeout(const Duration(minutes: 5));
  if (response.statusCode != 200) {
    throw UpdateException('La descarga respondió ${response.statusCode}.');
  }
  final actual = sha256.convert(response.bodyBytes).toString();
  if (actual != expectedSha256.trim().toLowerCase()) {
    throw UpdateException(
      'La descarga no coincide con la huella publicada. No se instaló.',
    );
  }
  final folder = Directory('${directory.path}/updates');
  await folder.create(recursive: true);
  final file = File('${folder.path}/vigia-update.apk');
  await file.writeAsBytes(response.bodyBytes, flush: true);
  return file;
}

const updateChannel = MethodChannel('co.vigia.movil/update');

/// Opens the Android package installer. The same signing key replaces the
/// installed app and keeps its data; a different key is rejected by the system.
Future<void> openApkInstaller(String path) async {
  if (!Platform.isAndroid) {
    throw const UpdateException(
      'Esta actualización es un APK de Android. En este equipo solo se puede anunciar.',
    );
  }
  await updateChannel.invokeMethod<void>('installApk', {'path': path});
}
