const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

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

module.exports = function withVigiaAndroid(config) {
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
