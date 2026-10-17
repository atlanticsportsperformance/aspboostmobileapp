import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const D = read('screens/exercise-detail-view.tsx');
const O = read('screens/block-overview.tsx');
const B = read('components/logger/FloatingVideoButton.tsx');
const Win = read('components/logger/FloatingVideoWindow.tsx');

describe('floating video wiring', () => {
  it('no inline YoutubePlayer left in the exercise body', () => {
    expect(D).not.toContain('<YoutubePlayer');
    expect(D).not.toContain("from 'react-native-youtube-iframe'");
    expect(D).not.toContain('function getYouTubeVideoId');
  });
  it('FloatingVideoButton rendered conditionally on hasVideo (and hidden with the keypad)', () => {
    expect(D.match(/<FloatingVideoButton/g)?.length).toBe(1);
    const i = D.indexOf('<FloatingVideoButton');
    const before = D.slice(Math.max(0, i - 200), i);
    expect(before).toContain('hasVideo(');
    expect(before).toContain('!activeInput');
  });
  it('the window is rendered and ⤢ opens the shared full-screen modal', () => {
    expect(D).toContain('<FloatingVideoWindow');
    expect(D).toContain('<VideoModal');
    expect(O).toContain('<VideoModal');
    expect(O).not.toContain('function getYouTubeVideoId');
    expect(O).toContain("from '../lib/video'");
  });
  it('non-YouTube links open full screen via Linking from the ▶', () => {
    const fn = D.slice(D.indexOf('const openVideo = '), D.indexOf('const openVideo = ') + 200);
    expect(fn).toContain('if (videoId) setFloatingVideoOpen(true)');
    expect(fn).toContain('Linking.openURL(videoUrl.trim())');
  });
  it('button shows the thumbnail with ▶ over it, plain ▶ otherwise', () => {
    expect(B).toContain('videoThumb(');
    expect(B).toContain('▶');
    expect(B).toMatch(/if \(!hasVideo\(url\)\) return null/);
  });
  it('window loops, drags clamped to the screen, ✕ closes, ⤢ expands; non-YouTube opens via Linking', () => {
    expect(Win).toContain('<YoutubePlayer');
    expect(Win).toContain('loop: true');
    expect(Win).toContain('PanResponder.create');
    expect(Win).toContain('useWindowDimensions');
    expect(Win).toContain('clamp(');
    expect(Win).toContain('· DEMO');
    expect(Win).toContain('⤢');
    expect(Win).toContain('✕');
    expect(Win).toContain('Linking.openURL');
    // overlay never blocks logging: the wrapper passes touches through
    expect(Win).toContain('pointerEvents="box-none"');
  });
  it('window collapses while the keypad is open (hidden + paused + muted) and comes back after', () => {
    const i = D.indexOf('<FloatingVideoWindow');
    const tag = D.slice(i, D.indexOf('/>', i));
    expect(tag).toContain('keypadOpen={!!activeInput}');
    expect(tag).not.toContain('keypadHeight');
    expect(D).not.toContain('setKeypadHeight');
    expect(Win).not.toContain('fitsAboveKeypad');
    expect(Win).toContain('const hidden = keypadOpen;');
    expect(Win).toContain('play={playing && !hidden}');
    expect(Win).toContain('mute={muted || hidden}');
    expect(Win).toMatch(/opacity: hidden \? 0 : 1/);
    expect(Win).toContain("pointerEvents={hidden ? 'none' : 'auto'}");
  });
  it('keypad renders directly (no measuring wrapper that re-lays out on open)', () => {
    expect(D).toMatch(/\{activeInput && \(\s*<NumericKeypad/);
  });
  it('player autoplays muted once ready, with chrome-free params typed by the library', () => {
    expect(Win).toContain('setPlaying(true)');
    expect(Win).toContain('controls: false');
    expect(Win).toContain('rel: false');
    expect(Win).toContain('iv_load_policy: 3');
    expect(Win).toContain('loop: true');
    expect(Win).toContain('playList={playList}');
    expect(Win).not.toContain('modestbranding');
  });
  it('player uses the local HTML (JSON play/mute messages work) with an https base URL and inline autoplay', () => {
    const i = Win.indexOf('<YoutubePlayer');
    const tag = Win.slice(i, Win.indexOf('/>', i));
    expect(tag).toContain('useLocalHTML');
    expect(tag).toContain('baseUrlOverride={PLAYER_BASE_URL}');
    expect(Win).toMatch(/const PLAYER_BASE_URL = 'https:\/\//);
    expect(tag).toContain('allowsInlineMediaPlayback: true');
    expect(tag).toContain('mediaPlaybackRequiresUserAction: false');
    expect(tag).toContain('mute={muted || hidden}');
  });
  it('starts muted with a tap-to-unmute control; openURL rejections are caught', () => {
    expect(Win).toContain('useState(true); // muted');
    expect(Win).toContain('setMuted((m) => !m)');
    expect(Win).toMatch(/Linking\.openURL\([^)]*\)\.catch\(/);
    expect(D).toMatch(/Linking\.openURL\(videoUrl\.trim\(\)\)\.catch\(/);
  });
});
