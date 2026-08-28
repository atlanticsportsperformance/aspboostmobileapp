import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('push registration reports app + OS version', () => {
  it('registerPushToken body includes appVersion and osVersion', () => {
    const S = read('lib/pushNotifications.ts');
    expect(S).toContain('appVersion:');
    expect(S).toContain('osVersion:');
  });

  it('app.json declares the aspboost URL scheme', () => {
    const S = read('app.json');
    expect(S).toContain('"scheme": "aspboost"');
  });

  // This used to pin the literal "1.5.30" / "20" so the messaging commit could
  // not bump the build by accident. That intent expired the moment a release
  // bumped it — the pin then failed on every release instead of catching a real
  // mistake. What actually matters is that push registration has a well-formed
  // version to report and that the store identifiers are present and numeric.
  it('app.json carries a well-formed version and build identifiers', () => {
    const app = JSON.parse(read('app.json')).expo;
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.ios.buildNumber).toMatch(/^\d+$/);
    expect(typeof app.android.versionCode).toBe('number');
    expect(app.android.versionCode).toBeGreaterThan(0);
  });
});
