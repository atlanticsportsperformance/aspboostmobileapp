import { stripeInitParams } from '../lib/stripePair';

describe('stripeInitParams', () => {
  const FALLBACK = 'pk_live_baked';

  it('legacy pair: server pk + connected account', () => {
    expect(stripeInitParams('pk_live_platform', 'acct_123', FALLBACK)).toEqual({
      publishableKey: 'pk_live_platform',
      stripeAccountId: 'acct_123',
    });
  });

  it('direct pair: server pk only, no stripeAccountId key at all', () => {
    const p = stripeInitParams('pk_live_asp', null, FALLBACK);
    expect(p).toEqual({ publishableKey: 'pk_live_asp' });
    expect('stripeAccountId' in p).toBe(false);
  });

  it('treats undefined / empty account as no account', () => {
    expect('stripeAccountId' in stripeInitParams('pk_x', undefined, FALLBACK)).toBe(false);
    expect('stripeAccountId' in stripeInitParams('pk_x', '', FALLBACK)).toBe(false);
  });

  it('missing server pk falls back to the baked key', () => {
    expect(stripeInitParams(undefined, 'acct_123', FALLBACK)).toEqual({
      publishableKey: FALLBACK,
      stripeAccountId: 'acct_123',
    });
    expect(stripeInitParams(null, null, FALLBACK)).toEqual({ publishableKey: FALLBACK });
    expect(stripeInitParams('', null, FALLBACK)).toEqual({ publishableKey: FALLBACK });
  });
});
