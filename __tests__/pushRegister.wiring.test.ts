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

  it('app.json version/buildNumber are unchanged', () => {
    const S = read('app.json');
    expect(S).toContain('"version": "1.5.30"');
    expect(S).toContain('"buildNumber": "20"');
  });
});
