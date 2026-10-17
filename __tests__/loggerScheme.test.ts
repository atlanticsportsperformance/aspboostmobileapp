import { normalizeScheme } from '../lib/logger/scheme';

describe('normalizeScheme', () => {
  it('maps straight variants and nullish to straight', () => {
    expect(normalizeScheme('straight')).toBe('straight');
    expect(normalizeScheme('straight_sets')).toBe('straight');
    expect(normalizeScheme(null)).toBe('straight');
    expect(normalizeScheme(undefined)).toBe('straight');
  });
  it('maps multi-exercise schemes to grouped', () => {
    for (const s of ['superset', 'circuit', 'emom', 'amrap', 'giant_set']) {
      expect(normalizeScheme(s)).toBe('grouped');
    }
  });
  it('maps text-only schemes to text', () => {
    expect(normalizeScheme('notes')).toBe('text');
    expect(normalizeScheme('warm_up')).toBe('text');
  });
});
