import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const D = read('screens/exercise-detail-view.tsx');
const O = read('screens/block-overview.tsx');
const V = read('components/logger/InlineDemoVideo.tsx');

describe('inline demo video (exercise screen)', () => {
  it('floating tile + window are gone; VideoModal is the ⤢ target here and in the overview', () => {
    expect(D).not.toContain('FloatingVideoButton');
    expect(D).not.toContain('FloatingVideoWindow');
    expect(D).toContain('<VideoModal videoId={fullVideoId} onClose={() => setFullVideoId(null)} />');
    expect(existsSync(join(__dirname, '..', 'components/logger/FloatingVideoWindow.tsx'))).toBe(false);
    expect(existsSync(join(__dirname, '..', 'components/logger/VideoModal.tsx'))).toBe(true);
    expect(O).toContain('<VideoModal');
    // the exercise screen itself mounts no player
    expect(D).not.toContain('<YoutubePlayer');
  });

  it('renders under the rx line, before the coach note, only when there is a video', () => {
    const rx = D.indexOf('{!!rx && <Text style={styles.rx}>{rx}</Text>}');
    const vid = D.indexOf('<InlineDemoVideo');
    const note = D.indexOf('{renderCoachNote()}');
    expect(rx).toBeGreaterThan(-1);
    expect(vid).toBeGreaterThan(rx);
    expect(note).toBeGreaterThan(vid);
    expect(D.slice(vid - 200, vid)).toContain('hasVideo(videoUrl) && (');
    const tag = D.slice(vid, D.indexOf('/>', vid));
    expect(tag).toContain('keypadOpen={!!activeInput}');
  });

  it('16:9, full width minus 16 px margins', () => {
    expect(V).toContain('const SIDE = 16;');
    expect(V).toContain('Math.round(W * (9 / 16))');
    expect(V).toContain('marginHorizontal: SIDE,');
  });

  it('"▶ DEMO" strip collapses the player; remembered for the session', () => {
    expect(V).toContain('▶ DEMO');
    expect(V).toContain('let collapsedThisSession = false;');
    expect(V).toContain('useState(collapsedThisSession)');
    expect(V).toContain('collapsedThisSession = !collapsed;');
  });

  it('hidden + paused while the keypad is open or collapsed (kept mounted)', () => {
    expect(V).toContain('const hidden = collapsed || keypadOpen;');
    expect(V).toContain('play={playing && !hidden && !paused}');
    expect(V).toContain('styles.videoHidden');
  });

  it('muted, looping, local HTML player with an https base URL and inline autoplay', () => {
    const i = V.indexOf('<YoutubePlayer');
    const tag = V.slice(i, V.indexOf('/>', i));
    expect(tag).toContain('mute={muted || hidden}');
    expect(tag).toContain('loop: true');
    expect(tag).toContain('playList={playList}');
    expect(tag).toContain('controls: false');
    expect(tag).toContain('useLocalHTML');
    expect(tag).toContain('baseUrlOverride={PLAYER_BASE_URL}');
    expect(V).toMatch(/const PLAYER_BASE_URL = 'https:\/\//);
    expect(tag).toContain('allowsInlineMediaPlayback: true');
    expect(tag).toContain('mediaPlaybackRequiresUserAction: false');
    expect(V).toContain('setPlaying(true)');
  });

  it('non-YouTube links: strip only, opens the link; openURL rejections caught', () => {
    expect(V).toContain('Linking.openURL(url.trim()).catch(() => {})');
    expect(V).toMatch(/\{!!videoId && \(\s*<View/);
  });

  it('keypad renders directly', () => {
    expect(D).toMatch(/\{activeInput && \(\s*<NumericKeypad/);
  });

  it('strip: mute toggle (starts muted) and ⤢ full screen (review I4)', () => {
    expect(V).toContain('useState(true); // muted');
    expect(V).toContain('setMuted((m) => !m)');
    expect(V).toContain("accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}");
    expect(V).toContain('onPress={() => onExpand(videoId)}');
    expect(V).toContain('⤢');
    const vid = D.indexOf('<InlineDemoVideo');
    const tag = D.slice(vid, D.indexOf('/>', vid));
    expect(tag).toContain('onExpand={setFullVideoId}');
  });

  it('pauses under the screen\'s modals (History / PR / full screen)', () => {
    expect(V).toContain('play={playing && !hidden && !paused}');
    const vid = D.indexOf('<InlineDemoVideo');
    const tag = D.slice(vid, D.indexOf('/>', vid));
    expect(tag).toContain('paused={showHistory || prPopoverOpen || fullVideoId != null}');
  });
});
