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

  it('disables the CTA for a gated item', () => {
    expect(SOURCE).toContain('disabled={hasActive || isGated}');
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
