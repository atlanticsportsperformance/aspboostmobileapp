import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, '..', 'lib', 'bookingApi.ts'), 'utf8');

describe('bookingApi asks the server instead of guessing', () => {
  it('no longer queries scheduling_events in the two LISTING functions', () => {
    // Scoped on purpose. `checkEligibility` (:561-…) also queries
    // scheduling_events and is NOT rewritten by this task — it is a
    // single-event template lookup, not a listing, and the shipped
    // ClassDetailsSheet still calls it. A whole-file assertion would fail
    // as written. Assert on the two functions this task actually replaces.
    const listings = SOURCE.slice(
      SOURCE.indexOf('export async function getBookableEvents('),
      SOURCE.indexOf('export async function getCategories(')
    );
    expect(listings).not.toContain("from('scheduling_events')");
  });

  it('leaves checkEligibility alone — it is the remaining direct query, deliberately', () => {
    const rest = SOURCE.slice(SOURCE.indexOf('export async function checkEligibility('));
    expect(rest).toContain("from('scheduling_events')");
    // …and it is the ONLY one left in the file.
    expect(SOURCE.split("from('scheduling_events')").length - 1).toBe(1);
  });

  it('calls the bookable-events route', () => {
    expect(SOURCE).toContain('/api/athletes/${athleteId}/bookable-events');
  });

  it('sends a bearer token like every other server call in this file', () => {
    expect(SOURCE).toContain('Authorization: `Bearer ${session.access_token}`');
  });
});

describe('the mapping is honest', () => {
  it('takes eligibility from the server rather than hardcoding true', () => {
    expect(SOURCE).not.toContain('isEligible: true');
    expect(SOURCE).toContain('isEligible: e.eligible !== false,');
  });

  it('carries the reason through so the UI can explain a refusal', () => {
    expect(SOURCE).toContain('ineligibleReason:');
    expect(SOURCE).toContain('ineligibleMessage:');
    expect(SOURCE).toContain('paymentRequiredCents:');
    expect(SOURCE).toContain('requiredMembershipTypeNames:');
  });

  it('stops labelling a video call with a building', () => {
    expect(SOURCE).not.toContain("'Main Facility'");
    expect(SOURCE).toContain('isRemote:');
    expect(SOURCE).toContain('meetingUrl:');
  });

  it('takes the capacity the server sends, not a second invented default', () => {
    expect(SOURCE).not.toContain('event.capacity || 10');
  });

  it('deletes the duplicated booking-window math', () => {
    expect(SOURCE).not.toContain('Bookings close ${bookingWindowHours}h before');
    expect(SOURCE).toContain('bookingWindowBlocked: e.booking_window_blocked === true,');
  });
});

describe('the exported surface is unchanged', () => {
  for (const fn of [
    'getLinkedAthletes',
    'getAthleteId',
    'getBookableEvents',
    'getBookableEventsForWeek',
    'getCategories',
    'checkEligibility',
    'getPaymentMethods',
    'createBooking',
    'cancelBooking',
  ]) {
    it(`still exports ${fn}`, () => {
      expect(SOURCE).toContain(`export async function ${fn}`);
    });
  }
});
