/**
 * Keeps Android phones on their native portrait lock.
 *
 * app.json `orientation` is "default" so the iPad rack can go landscape (the
 * iOS plist sets portrait for iPhone, all four for iPad). On
 * Android "default" would make MainActivity `unspecified`, so this sets
 * android:screenOrientation="portrait" back on MainActivity. Rack mode is
 * iOS-only; a runtime ScreenOrientation.lockAsync still overrides this.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withAndroidPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    main.$['android:screenOrientation'] = 'portrait';
    return cfg;
  });
};
