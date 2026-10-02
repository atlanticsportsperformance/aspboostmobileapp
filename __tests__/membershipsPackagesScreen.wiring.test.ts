import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'screens', 'MembershipsPackagesScreen.tsx'),
  'utf8'
);

describe('the screen asks the server what is buyable', () => {
  it('calls the purchasable endpoint', () => {
    expect(SOURCE).toContain('/api/athletes/${targetAthleteId}/purchasable');
  });

  it('merges eligibility onto the display rows by id', () => {
    expect(SOURCE).toContain('eligibilityByMembershipTypeId');
    expect(SOURCE).toContain('eligibilityByPackageTypeId');
  });
});

describe('an ineligible plan is shown, locked, with the reason', () => {
  it('reads the eligibility fields the endpoint returns', () => {
    expect(SOURCE).toContain('ineligible_message');
    expect(SOURCE).toContain('eligible === false');
  });

  // The row CTA used to read `disabled={hasActive || isGated}` inline; the
  // compact-rows rework moved both terms into named locals. Assert the rule —
  // a gated plan cannot be bought — rather than one spelling of it.
  it('disables the row CTA for a gated item', () => {
    expect(SOURCE).toContain('const isGated = type.eligible === false;');
    expect(SOURCE).toContain('const disabled = isGated || !!activeLabel;');
    expect(SOURCE).toContain('disabled={disabled}');
  });

  it('disables checkout when the plan is gated for the athlete being bought for', () => {
    expect(SOURCE).toContain('isSelectedItemGatedForAthlete');
    const buyDisabled = SOURCE.split('const buyDisabled =')[1]?.split(';')[0] ?? '';
    expect(buyDisabled).toContain('isSelectedItemGatedForAthlete');
    expect(SOURCE).toContain('disabled={buyDisabled}');
  });
});

describe('the CTA tells setup-intent what is being bought', () => {
  it('sends the type id so the parent is refused before their card is saved', () => {
    expect(SOURCE).toContain('membership_type_id: selectedItem.id');
  });
});

describe('a parent can buy for any linked athlete, not just the first', () => {
  it('checks eligibility for every linked athlete, not only the first', () => {
    expect(SOURCE).toContain('purchasablePerAthlete');
  });

  it('re-checks eligibility against whichever athlete is selected in the purchase modal', () => {
    expect(SOURCE).toContain('eligibilityForSelectedAthlete');
    expect(SOURCE).toContain('purchaseForAthleteId');
  });
});

describe('no credentials in device logs', () => {
  it('does not log a token preview', () => {
    expect(SOURCE).not.toContain('tokenPreview');
    expect(SOURCE).not.toContain('access_token.substring');
  });
});

describe('the uncommitted error-shape fixes survive', () => {
  it('still prefers data.message over data.error', () => {
    const occurrences = SOURCE.split('data.message || data.error').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// 2026-10-02: a $450 membership was charged in full with GHOST200 sitting in
// the promo box. The checkout body read `appliedCoupon` only, so a code the
// parent typed but never tapped Apply on was dropped without a word and the
// SetupIntent carried no coupon. Never charge past a pending code again.
describe('a promo code typed but never Applied still counts at checkout', () => {
  it('resolves the pending code instead of reading only the applied one', () => {
    expect(SOURCE).toContain('const pendingCode = couponInput.trim();');
    expect(SOURCE).toContain('if (!couponForCheckout && pendingCode) {');
    expect(SOURCE).toContain('const couponCodeForCheckout = couponForCheckout?.code || undefined;');
  });

  it('prices the pending code against the plan actually being bought', () => {
    const block = SOURCE.split('const pendingCode = couponInput.trim();')[1]?.slice(0, 400) ?? '';
    expect(block).toContain('quoteCoupon(');
    expect(block).toContain('effectivePriceCents || selectedItem.price_amount');
  });

  it('refuses to charge when the pending code does not check out', () => {
    const block = SOURCE.split('const pendingCode = couponInput.trim();')[1]?.slice(0, 700) ?? '';
    expect(block).toContain('if (!quote) {');
    expect(block).toContain('Check your promo code');
    expect(block).toContain('return;');
  });

  it('never sends the raw typed string as the coupon — only a validated quote', () => {
    expect(SOURCE).not.toContain('coupon_code: couponInput');
    expect(SOURCE).toContain('couponForCheckout = quote;');
  });
});
