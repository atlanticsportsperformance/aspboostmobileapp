import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('booking components — a gated session says why, not "Reserve"', () => {
  it('EventRow shows a gate chip from the server verdict, ahead of Full/Reserve', () => {
    const S = read('components/booking/EventRow.tsx');
    expect(S).toContain('event.isEligible === false && event.ineligibleReason');
    expect(S).toContain("'Members only'");
    expect(S.indexOf('event.ineligibleReason')).toBeLessThan(S.indexOf('if (isFull)'));
  });
  it('ClassDetailsSheet treats the server gate as blocked and names the plan', () => {
    const S = read('components/booking/ClassDetailsSheet.tsx');
    expect(S).toContain("eligibility?.sourceType === 'blocked' || isGatedByServer");
    expect(S).toContain('event.ineligibleMessage');
    expect(S).toContain('event.requiredMembershipTypeNames');
    expect(S).toContain("'Members Only'");
  });
});
