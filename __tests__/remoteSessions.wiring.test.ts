import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('DashboardScreen — booked remote sessions carry a Join row', () => {
  const S = read('screens/DashboardScreen.tsx');
  it('selects the two fields on the embedded event', () => {
    expect(S).toContain('is_remote,');
    expect(S).toContain('meeting_url,');
  });
  it('opens the link with Linking, like MessagesScreen', () => {
    expect(S).toMatch(/import \{[^}]*\bLinking\b[^}]*\} from 'react-native';/);
    expect(S).toContain('Linking.openURL(');
    expect(S).toContain('Join video call');
  });
});

describe('booking components — Video call instead of a missing room', () => {
  it('EventRow', () => {
    const S = read('components/booking/EventRow.tsx');
    expect(S).toContain("{event.isRemote ? 'Video call' : event.location}");
  });
  it('ClassDetailsSheet shows Video call and a Join once booked', () => {
    const S = read('components/booking/ClassDetailsSheet.tsx');
    expect(S).toContain("{event.isRemote ? 'Video call' : event.location}");
    expect(S).toContain('{event.isRemote && event.isBooked && event.meetingUrl && (');
    expect(S).toContain('Linking.openURL(');
  });
  it('CancelConfirmationSheet', () => {
    const S = read('components/booking/CancelConfirmationSheet.tsx');
    expect(S).toContain("{event.isRemote ? 'Video call' : event.location}");
  });
});

describe('coach list — a remote session says so', () => {
  it('CoachSession carries the fields', () => {
    const S = read('lib/coachScheduleApi.ts');
    expect(S).toContain('is_remote?: boolean;');
    expect(S).toContain('meeting_url?: string | null;');
  });
  it('CoachDashboardScreen renders Video call', () => {
    const S = read('screens/CoachDashboardScreen.tsx');
    expect(S).toContain("session.is_remote ? 'Video call' : session.location?.name");
  });
});
