import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('remote sessions — Join is a button, and it shows on the dashboard', () => {
  it('ClassDetailsSheet renders a full-width Join button for a booked remote session', () => {
    const S = read('components/booking/ClassDetailsSheet.tsx');
    expect(S).toContain('event.isRemote && event.isBooked && event.meetingUrl');
    expect(S).toContain('style={styles.joinBtn}');
    expect(S).toContain('accessibilityLabel="Join video call"');
    expect(S).not.toContain("textDecorationLine: 'underline' }]}>Join video call");
  });
  it('ClassDetailsSheet says Reserve Session, not Reserve Class, for a remote event', () => {
    const S = read('components/booking/ClassDetailsSheet.tsx');
    expect(S).toContain("event.isRemote ? 'Reserve Session' : 'Reserve Class'");
  });
  it('BookingScreen success/error copy says session for remote events', () => {
    const S = read('screens/BookingScreen.tsx');
    expect(S).toContain("selectedEvent.isRemote ? 'Session reserved");
    expect(S).toContain("selectedEvent.isRemote ? 'Failed to reserve session'");
  });
  it('UpcomingPreview carries meeting_url from the booking and renders a Join button', () => {
    const S = read('components/dashboard/feed/UpcomingPreview.tsx');
    expect(S).toContain('is_remote?: boolean;');
    expect(S).toContain('meeting_url?: string | null;');
    expect(S).toContain('joinUrl: b.event.is_remote && b.event.meeting_url ? b.event.meeting_url : null');
    expect(S).toContain('item.joinUrl && !item.done');
    expect(S).toContain('Linking.openURL(item.joinUrl as string)');
  });
  it('Dashboard bookings query selects is_remote and meeting_url so the feed can render Join', () => {
    const S = read('screens/DashboardScreen.tsx');
    const q = S.indexOf("freshClient.from('scheduling_bookings').select(`");
    const block = S.slice(q, q + 600);
    expect(block).toContain('is_remote,');
    expect(block).toContain('meeting_url,');
    expect(S).toContain("booking.event?.is_remote && booking.event?.meeting_url && !passed");
  });
});
