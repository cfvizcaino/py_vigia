const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const networkConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">::1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">10.0.3.2</domain>
  </domain-config>
</network-security-config>`;

const filePaths = `<?xml version="1.0" encoding="utf-8"?>
<paths><cache-path name="updates" path="updates/" /></paths>`;

// Release signing with the same key as the Flutter app, so the update installs
// over it and keeps its data. The key stays outside the repository: Flutter's
// apps/movil/android/key.properties, or the file named by
// VIGIA_ANDROID_KEY_PROPERTIES. Without it release builds use the debug key.
const releaseSigning = `
def vigiaKeyProperties = new Properties()
def vigiaKeyFile = file(System.getenv("VIGIA_ANDROID_KEY_PROPERTIES") ?: "../../../movil/android/key.properties")
if (vigiaKeyFile.exists()) vigiaKeyFile.withInputStream { vigiaKeyProperties.load(it) }
`;

const releaseSigningConfig = `
        if (!vigiaKeyProperties.isEmpty()) {
            release {
                storeFile file(vigiaKeyProperties.getProperty("storeFile"))
                storePassword vigiaKeyProperties.getProperty("storePassword")
                keyAlias vigiaKeyProperties.getProperty("keyAlias")
                keyPassword vigiaKeyProperties.getProperty("keyPassword")
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes('vigiaKeyProperties')) return mod;
    gradle = gradle.replace(/^android \{/m, `${releaseSigning}\nandroid {`);
    gradle = gradle.replace(/signingConfigs \{/, `signingConfigs {${releaseSigningConfig}`);
    const release = gradle.indexOf('release {', gradle.indexOf('buildTypes {'));
    if (release < 0) throw new Error('No se encontró buildTypes.release en app/build.gradle.');
    const debugSigning = gradle.indexOf('signingConfig signingConfigs.debug', release);
    if (debugSigning < 0) throw new Error('No se encontró la firma de release en app/build.gradle.');
    gradle =
      gradle.slice(0, debugSigning) +
      'signingConfig signingConfigs.findByName("release") ?: signingConfigs.debug' +
      gradle.slice(debugSigning + 'signingConfig signingConfigs.debug'.length);
    mod.modResults.contents = gradle;
    return mod;
  });
}

module.exports = function withVigiaAndroid(config) {
  config = withReleaseSigning(config);
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('No se encontró el elemento application del manifest Android.');
    app.$['android:networkSecurityConfig'] = '@xml/vigia_network_security_config';
    app.$['android:allowBackup'] = 'false';
    app.$['android:usesCleartextTraffic'] = 'false';
    const providers = app.provider ?? (app.provider = []);
    const authority = '${applicationId}.fileprovider';
    const existing = providers.find((provider) => provider.$['android:authorities'] === authority);
    if (!existing) {
      providers.push({
        $: {
          'android:name': 'androidx.core.content.FileProvider',
          'android:authorities': authority,
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
        },
        'meta-data': [{
          $: {
            'android:name': 'android.support.FILE_PROVIDER_PATHS',
            'android:resource': '@xml/vigia_file_paths',
          },
        }],
      });
    }
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const resourceDirectory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      await fs.mkdir(resourceDirectory, { recursive: true });
      await fs.writeFile(path.join(resourceDirectory, 'vigia_network_security_config.xml'), networkConfig);
      await fs.writeFile(path.join(resourceDirectory, 'vigia_file_paths.xml'), filePaths);
      return mod;
    },
  ]);
};
